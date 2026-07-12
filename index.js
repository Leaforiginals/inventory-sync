require("dotenv").config();
const express = require("express");
const crypto = require("crypto");

const { getAccessToken, updateInventory } = require("./shopify");
const {
  buildCache,
  getSkuByLeafItemId,
  getSkuBySoohiItemId,
  getSoohiTargetBySku,
  getLeafTargetBySku,
} = require("./skuCache");

const app = express();

// Raw body chahiye HMAC verify karne ke liye — isliye express.json() nahi, raw parser use kar rahe hain
app.use(express.raw({ type: "application/json" }));

let leafToken = null;
let soohiToken = null;

// Recently-synced tracker — infinite loop rokne ke liye
// key: "leaf:SKU123" ya "soohi:SKU123", value: { quantity, time }
const recentlySynced = new Map();
const SYNC_IGNORE_WINDOW_MS = 15000; // 15 second

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
    .update(req.body) // raw buffer
    .digest("base64");

  return crypto.timingSafeEqual(
    Buffer.from(generatedHash),
    Buffer.from(hmacHeader)
  );
}

// ================================
// Leaf → Soohi
// ================================
app.post("/webhooks/leaf", async (req, res) => {
  res.status(200).send("ok"); // Shopify ko turant respond karo, baaki kaam background mein

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
// Soohi → Leaf
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

  // Har 6 ghante mein cache refresh (naye products add hone ki wajah se)
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