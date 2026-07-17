const { getInventory } = require("./inventory");

const cache = {
  leafBySku: new Map(),
  leafByItemId: new Map(),
  soohiBySku: new Map(),
  soohiByItemId: new Map(),
  leafProductSkus: new Map(),
  soohiProductSkus: new Map(),
};

async function buildCache(
  leafShop,
  leafToken,
  leafLocationId,
  soohiShop,
  soohiToken,
  soohiLocationId
) {
  console.log("Building SKU cache...");

  const leafInventory = await getInventory(leafShop, leafToken, leafLocationId);
  const soohiInventory = await getInventory(soohiShop, soohiToken, soohiLocationId);

  cache.leafBySku.clear();
  cache.leafByItemId.clear();
  cache.soohiBySku.clear();
  cache.soohiByItemId.clear();
  cache.leafProductSkus.clear();
  cache.soohiProductSkus.clear();

  for (const item of leafInventory) {
    if (!item.sku || item.sku.trim() === "") continue;
    const sku = item.sku.trim().toUpperCase();

    cache.leafBySku.set(sku, {
      inventoryItemId: item.inventoryItemId,
      locationId: leafLocationId,
      productId: item.productId,
      variantId: item.variantId,
    });
    cache.leafByItemId.set(item.inventoryItemId, sku);

    if (!cache.leafProductSkus.has(item.productId)) {
      cache.leafProductSkus.set(item.productId, new Set());
    }
    cache.leafProductSkus.get(item.productId).add(sku);
  }

  for (const item of soohiInventory) {
    if (!item.sku || item.sku.trim() === "") continue;
    const sku = item.sku.trim().toUpperCase();

    cache.soohiBySku.set(sku, {
      inventoryItemId: item.inventoryItemId,
      locationId: soohiLocationId,
      productId: item.productId,
      variantId: item.variantId,
    });
    cache.soohiByItemId.set(item.inventoryItemId, sku);

    if (!cache.soohiProductSkus.has(item.productId)) {
      cache.soohiProductSkus.set(item.productId, new Set());
    }
    cache.soohiProductSkus.get(item.productId).add(sku);
  }

  console.log(
    `SKU cache ready — Leaf: ${cache.leafBySku.size}, Soohi: ${cache.soohiBySku.size}`
  );
}

function getSkuByLeafItemId(inventoryItemId) {
  return cache.leafByItemId.get(inventoryItemId);
}

function getSkuBySoohiItemId(inventoryItemId) {
  return cache.soohiByItemId.get(inventoryItemId);
}

function getSoohiTargetBySku(sku) {
  return cache.soohiBySku.get(sku);
}

function getLeafTargetBySku(sku) {
  return cache.leafBySku.get(sku);
}

function getLeafProductSkus(productId) {
  return cache.leafProductSkus.get(productId) || new Set();
}

function getSoohiProductSkus(productId) {
  return cache.soohiProductSkus.get(productId) || new Set();
}

// ================================
// Instantly add a new SKU mapping (used right after creating a variant/product)
// so a follow-up inventory webhook doesn't miss it before the next full refresh
// ================================
function addLeafMapping(sku, inventoryItemId, locationId, productId, variantId) {
  cache.leafBySku.set(sku, { inventoryItemId, locationId, productId, variantId });
  cache.leafByItemId.set(inventoryItemId, sku);
  if (!cache.leafProductSkus.has(productId)) {
    cache.leafProductSkus.set(productId, new Set());
  }
  cache.leafProductSkus.get(productId).add(sku);
}

function addSoohiMapping(sku, inventoryItemId, locationId, productId, variantId) {
  cache.soohiBySku.set(sku, { inventoryItemId, locationId, productId, variantId });
  cache.soohiByItemId.set(inventoryItemId, sku);
  if (!cache.soohiProductSkus.has(productId)) {
    cache.soohiProductSkus.set(productId, new Set());
  }
  cache.soohiProductSkus.get(productId).add(sku);
}

module.exports = {
  buildCache,
  getSkuByLeafItemId,
  getSkuBySoohiItemId,
  getSoohiTargetBySku,
  getLeafTargetBySku,
  getLeafProductSkus,
  getSoohiProductSkus,
  addLeafMapping,
  addSoohiMapping,
};