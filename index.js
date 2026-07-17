require("dotenv").config();
const express = require("express");
const crypto = require("crypto");

const { getAccessToken, updateInventory, updateProductStatus, deleteVariants, createVariantOnProduct, createNewProduct } = require("./shopify");
const {
  buildCache,
  getSkuByLeafItemId,
  getSkuBySoohiItemId,
  getSoohiTargetBySku,
  getLeafTargetBySku,
  getLeafProductSkus,
  getSoohiProductSkus,
  addLeafMapping,
  addSoohiMapping,
} = require("./skuCache");

const app = express();

app.use(express.raw({ type: "application/json" }));

let leafToken = null;
let soohiToken = null;

const recentlySynced = new Map();
const SYNC_IGNORE_WINDOW_MS = 15000;

function markSynced(store, sku, quantity) {
  recentlySynced.set(`${store}:${sku}`, { quantity, time: Date.now() });
}

function wasJustSynced(store, sku, quantity) {
  const entry = recentlySynced.get(`${store}:${sku}`);
  if (!entry) return false;
  const isRecent = Date.now() - entry.time < SYNC_IGNORE_WINDOW_MS;
  return isRecent && entry.quantity === quantity;
}

function verifyShopifyWebhook(req, secret) {
  const hmacHeader = req.get("X-Shopify-Hmac-Sha256");
  if (!hmacHeader) return false;

  const generatedHash = crypto
    .createHmac("sha256", secret)
    .update(req.body)
    .digest("base64");

  return crypto.timingSafeEqual(
    Buffer.from(generatedHash),
    Buffer.from(hmacHeader)
  );
}

// ================================
// Leaf → Soohi (Inventory)
// ================================
app.post("/webhooks/leaf", async (req, res) => {
  res.status(200).send("ok");

  try {
    const isValid = verifyShopifyWebhook(req, process.env.LEAF_CLIENT_SECRET);
    if (!isValid) {
      console.log("❌ Invalid webhook signature (Leaf)");
      return;
    }

    const payload = JSON.parse(req.body.toString());
    const inventoryItemId = `gid://shopify/InventoryItem/${payload.inventory_item_id}`;
    const newQuantity = payload.available;

    const sku = getSkuByLeafItemId(inventoryItemId);
    if (!sku) {
      console.log("⚠️ Unknown SKU for Leaf item:", inventoryItemId);
      return;
    }

    if (wasJustSynced("leaf", sku, newQuantity)) {
      console.log(`↩️ Skipping echo for SKU ${sku} (Leaf)`);
      return;
    }

    const target = getSoohiTargetBySku(sku);
    if (!target) {
      console.log(`⚠️ No matching SKU in Soohi for ${sku}`);
      return;
    }

    markSynced("soohi", sku, newQuantity);

    await updateInventory(
      process.env.SOOHI_SHOP,
      soohiToken,
      target.inventoryItemId,
      target.locationId,
      newQuantity
    );

    console.log(`✅ Synced SKU ${sku}: Leaf → Soohi (qty ${newQuantity})`);
  } catch (err) {
    console.log("❌ Error in Leaf webhook:", err.message);
  }
});

// ================================
// Soohi → Leaf (Inventory)
// ================================
app.post("/webhooks/soohi", async (req, res) => {
  res.status(200).send("ok");

  try {
    const isValid = verifyShopifyWebhook(req, process.env.SOOHI_CLIENT_SECRET);
    if (!isValid) {
      console.log("❌ Invalid webhook signature (Soohi)");
      return;
    }

    const payload = JSON.parse(req.body.toString());
    const inventoryItemId = `gid://shopify/InventoryItem/${payload.inventory_item_id}`;
    const newQuantity = payload.available;

    const sku = getSkuBySoohiItemId(inventoryItemId);
    if (!sku) {
      console.log("⚠️ Unknown SKU for Soohi item:", inventoryItemId);
      return;
    }

    if (wasJustSynced("soohi", sku, newQuantity)) {
      console.log(`↩️ Skipping echo for SKU ${sku} (Soohi)`);
      return;
    }

    const target = getLeafTargetBySku(sku);
    if (!target) {
      console.log(`⚠️ No matching SKU in Leaf for ${sku}`);
      return;
    }

    markSynced("leaf", sku, newQuantity);

    await updateInventory(
      process.env.LEAF_SHOP,
      leafToken,
      target.inventoryItemId,
      target.locationId,
      newQuantity
    );

    console.log(`✅ Synced SKU ${sku}: Soohi → Leaf (qty ${newQuantity})`);
  } catch (err) {
    console.log("❌ Error in Soohi webhook:", err.message);
  }
});

// ================================
// Leaf Product Update (status + variant delete + variant/product create)
// ================================
app.post("/webhooks/leaf-product", async (req, res) => {
  res.status(200).send("ok");

  try {
    const isValid = verifyShopifyWebhook(req, process.env.LEAF_CLIENT_SECRET);
    if (!isValid) {
      console.log("❌ Invalid webhook signature (Leaf product)");
      return;
    }

    const payload = JSON.parse(req.body.toString());
    const productId = `gid://shopify/Product/${payload.id}`;
    const status = payload.status.toUpperCase();

    const currentSkus = new Set(
      payload.variants
        .filter((v) => v.sku && v.sku.trim() !== "")
        .map((v) => v.sku.trim().toUpperCase())
    );

    const previousSkus = getLeafProductSkus(productId);
    const deletedSkus = [...previousSkus].filter((sku) => !currentSkus.has(sku));
    const createdSkus = [...currentSkus].filter((sku) => !previousSkus.has(sku));

    if (deletedSkus.length > 0) {
      console.log(`🗑️ Detected deleted SKUs on Leaf: ${deletedSkus.join(", ")}`);

      const bySoohiProduct = new Map();
      for (const sku of deletedSkus) {
        const target = getSoohiTargetBySku(sku);
        if (!target) continue;
        if (!bySoohiProduct.has(target.productId)) {
          bySoohiProduct.set(target.productId, []);
        }
        bySoohiProduct.get(target.productId).push(target);
      }

      for (const [soohiProductIdToEdit, targets] of bySoohiProduct.entries()) {
        try {
          const variantIds = targets.map((t) => t.variantId).filter(Boolean);
          if (variantIds.length > 0) {
            await deleteVariants(process.env.SOOHI_SHOP, soohiToken, soohiProductIdToEdit, variantIds);
            console.log(`✅ Deleted ${variantIds.length} variant(s) on Soohi`);
          }
        } catch (err) {
          console.log("❌ Error deleting Soohi variants:", err.message);
        }
      }
    }

    let soohiProductId = null;
    for (const sku of currentSkus) {
      const target = getSoohiTargetBySku(sku);
      if (target) {
        soohiProductId = target.productId;
        break;
      }
    }

    if (createdSkus.length > 0) {
      const optionName = payload.options && payload.options[0] ? payload.options[0].name : "Title";

      if (previousSkus.size === 0) {
        const variantsData = payload.variants
          .filter((v) => v.sku && v.sku.trim() !== "")
          .map((v) => ({
            sku: v.sku.trim().toUpperCase(),
            optionValue: v.option1,
            quantity: v.inventory_quantity || 0,
            rawVariant: v,
          }));

        if (variantsData.length > 0) {
          try {
            const title = variantsData[0].sku;
            const result = await createNewProduct(process.env.SOOHI_SHOP, soohiToken, title, optionName, variantsData, process.env.SOOHI_LOCATION_ID);

            for (let i = 0; i < result.variants.length; i++) {
              const sku = variantsData[i].sku;
              const rawVariant = variantsData[i].rawVariant;

              addSoohiMapping(
                sku,
                result.variants[i].inventoryItem.id,
                process.env.SOOHI_LOCATION_ID,
                result.productId,
                result.variants[i].id
              );

              addLeafMapping(
                sku,
                `gid://shopify/InventoryItem/${rawVariant.inventory_item_id}`,
                process.env.LEAF_LOCATION_ID,
                productId,
                `gid://shopify/ProductVariant/${rawVariant.id}`
              );
            }

            console.log(`✅ Created new product on Soohi with ${variantsData.length} variant(s)`);
          } catch (err) {
            console.log("❌ Error creating new product on Soohi:", err.message);
          }
        }
      } else if (soohiProductId) {
        for (const sku of createdSkus) {
          const variant = payload.variants.find((v) => v.sku && v.sku.trim().toUpperCase() === sku);
          if (!variant) continue;

          try {
            const createdVariant = await createVariantOnProduct(
              process.env.SOOHI_SHOP,
              soohiToken,
              soohiProductId,
              optionName,
              variant.option1,
              sku,
              variant.inventory_quantity || 0,
              process.env.SOOHI_LOCATION_ID
            );

            addSoohiMapping(
              sku,
              createdVariant.inventoryItem.id,
              process.env.SOOHI_LOCATION_ID,
              soohiProductId,
              createdVariant.id
            );

            addLeafMapping(
              sku,
              `gid://shopify/InventoryItem/${variant.inventory_item_id}`,
              process.env.LEAF_LOCATION_ID,
              productId,
              `gid://shopify/ProductVariant/${variant.id}`
            );

            console.log(`✅ Created new variant on Soohi: ${sku}`);
          } catch (err) {
            console.log(`❌ Error creating variant ${sku} on Soohi:`, err.message);
          }
        }
      } else {
        console.log("⚠️ New variant(s) on Leaf but no matching Soohi product found — skipping");
      }
    }

    if (soohiProductId) {
      await updateProductStatus(process.env.SOOHI_SHOP, soohiToken, soohiProductId, status);
      console.log(`✅ Synced status to Soohi: ${status}`);
    } else {
      console.log("⚠️ Could not find matching Soohi product for status sync");
    }
  } catch (err) {
    console.log("❌ Error in Leaf product webhook:", err.message);
  }
});

// ================================
// Soohi Product Update (status + variant delete + variant/product create)
// ================================
app.post("/webhooks/soohi-product", async (req, res) => {
  res.status(200).send("ok");

  try {
    const isValid = verifyShopifyWebhook(req, process.env.SOOHI_CLIENT_SECRET);
    if (!isValid) {
      console.log("❌ Invalid webhook signature (Soohi product)");
      return;
    }

    const payload = JSON.parse(req.body.toString());
    const productId = `gid://shopify/Product/${payload.id}`;
    const status = payload.status.toUpperCase();

    const currentSkus = new Set(
      payload.variants
        .filter((v) => v.sku && v.sku.trim() !== "")
        .map((v) => v.sku.trim().toUpperCase())
    );

    const previousSkus = getSoohiProductSkus(productId);
    const deletedSkus = [...previousSkus].filter((sku) => !currentSkus.has(sku));
    const createdSkus = [...currentSkus].filter((sku) => !previousSkus.has(sku));

    if (deletedSkus.length > 0) {
      console.log(`🗑️ Detected deleted SKUs on Soohi: ${deletedSkus.join(", ")}`);

      const byLeafProduct = new Map();
      for (const sku of deletedSkus) {
        const target = getLeafTargetBySku(sku);
        if (!target) continue;
        if (!byLeafProduct.has(target.productId)) {
          byLeafProduct.set(target.productId, []);
        }
        byLeafProduct.get(target.productId).push(target);
      }

      for (const [leafProductIdToEdit, targets] of byLeafProduct.entries()) {
        try {
          const variantIds = targets.map((t) => t.variantId).filter(Boolean);
          if (variantIds.length > 0) {
            await deleteVariants(process.env.LEAF_SHOP, leafToken, leafProductIdToEdit, variantIds);
            console.log(`✅ Deleted ${variantIds.length} variant(s) on Leaf`);
          }
        } catch (err) {
          console.log("❌ Error deleting Leaf variants:", err.message);
        }
      }
    }

    let leafProductId = null;
    for (const sku of currentSkus) {
      const target = getLeafTargetBySku(sku);
      if (target) {
        leafProductId = target.productId;
        break;
      }
    }

    if (createdSkus.length > 0) {
      const optionName = payload.options && payload.options[0] ? payload.options[0].name : "Title";

      if (previousSkus.size === 0) {
        const variantsData = payload.variants
          .filter((v) => v.sku && v.sku.trim() !== "")
          .map((v) => ({
            sku: v.sku.trim().toUpperCase(),
            optionValue: v.option1,
            quantity: v.inventory_quantity || 0,
            rawVariant: v,
          }));

        if (variantsData.length > 0) {
          try {
            const title = variantsData[0].sku;
            const result = await createNewProduct(process.env.LEAF_SHOP, leafToken, title, optionName, variantsData, process.env.LEAF_LOCATION_ID);

            for (let i = 0; i < result.variants.length; i++) {
              const sku = variantsData[i].sku;
              const rawVariant = variantsData[i].rawVariant;

              addLeafMapping(
                sku,
                result.variants[i].inventoryItem.id,
                process.env.LEAF_LOCATION_ID,
                result.productId,
                result.variants[i].id
              );

              addSoohiMapping(
                sku,
                `gid://shopify/InventoryItem/${rawVariant.inventory_item_id}`,
                process.env.SOOHI_LOCATION_ID,
                productId,
                `gid://shopify/ProductVariant/${rawVariant.id}`
              );
            }

            console.log(`✅ Created new product on Leaf with ${variantsData.length} variant(s)`);
          } catch (err) {
            console.log("❌ Error creating new product on Leaf:", err.message);
          }
        }
      } else if (leafProductId) {
        for (const sku of createdSkus) {
          const variant = payload.variants.find((v) => v.sku && v.sku.trim().toUpperCase() === sku);
          if (!variant) continue;

          try {
            const createdVariant = await createVariantOnProduct(
              process.env.LEAF_SHOP,
              leafToken,
              leafProductId,
              optionName,
              variant.option1,
              sku,
              variant.inventory_quantity || 0,
              process.env.LEAF_LOCATION_ID
            );

            addLeafMapping(
              sku,
              createdVariant.inventoryItem.id,
              process.env.LEAF_LOCATION_ID,
              leafProductId,
              createdVariant.id
            );

            addSoohiMapping(
              sku,
              `gid://shopify/InventoryItem/${variant.inventory_item_id}`,
              process.env.SOOHI_LOCATION_ID,
              productId,
              `gid://shopify/ProductVariant/${variant.id}`
            );

            console.log(`✅ Created new variant on Leaf: ${sku}`);
          } catch (err) {
            console.log(`❌ Error creating variant ${sku} on Leaf:`, err.message);
          }
        }
      } else {
        console.log("⚠️ New variant(s) on Soohi but no matching Leaf product found — skipping");
      }
    }

    if (leafProductId) {
      await updateProductStatus(process.env.LEAF_SHOP, leafToken, leafProductId, status);
      console.log(`✅ Synced status to Leaf: ${status}`);
    } else {
      console.log("⚠️ Could not find matching Leaf product for status sync");
    }
  } catch (err) {
    console.log("❌ Error in Soohi product webhook:", err.message);
  }
});

// ================================
// Manual Cache Refresh
// ================================
app.get("/refresh-cache", async (req, res) => {
  try {
    await buildCache(
      process.env.LEAF_SHOP,
      leafToken,
      process.env.LEAF_LOCATION_ID,
      process.env.SOOHI_SHOP,
      soohiToken,
      process.env.SOOHI_LOCATION_ID
    );
    res.status(200).send("✅ Cache refreshed successfully");
  } catch (err) {
    res.status(500).send("❌ Cache refresh failed: " + err.message);
  }
});

// ================================
// Startup
// ================================
async function start() {
  console.log("======================================");
  console.log(" Leaf ↔ Soohi Inventory Sync Server");
  console.log("======================================");

  leafToken = await getAccessToken(
    process.env.LEAF_SHOP,
    process.env.LEAF_CLIENT_ID,
    process.env.LEAF_CLIENT_SECRET
  );
  console.log("✅ Leaf Token Generated");

  soohiToken = await getAccessToken(
    process.env.SOOHI_SHOP,
    process.env.SOOHI_CLIENT_ID,
    process.env.SOOHI_CLIENT_SECRET
  );
  console.log("✅ Soohi Token Generated");

  await buildCache(
    process.env.LEAF_SHOP,
    leafToken,
    process.env.LEAF_LOCATION_ID,
    process.env.SOOHI_SHOP,
    soohiToken,
    process.env.SOOHI_LOCATION_ID
  );

  setInterval(() => {
    buildCache(
      process.env.LEAF_SHOP,
      leafToken,
      process.env.LEAF_LOCATION_ID,
      process.env.SOOHI_SHOP,
      soohiToken,
      process.env.SOOHI_LOCATION_ID
    ).catch((err) => console.log("Cache refresh failed:", err.message));
  }, 6 * 60 * 60 * 1000);

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`✅ Server listening on port ${PORT}`);
  });
}

start();