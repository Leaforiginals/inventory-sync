const { getInventory } = require("./inventory");

const cache = {
  leafBySku: new Map(),
  leafByItemId: new Map(),
  soohiBySku: new Map(),
  soohiByItemId: new Map(),
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

  for (const item of leafInventory) {
    if (!item.sku || item.sku.trim() === "") continue;
    const sku = item.sku.trim().toUpperCase();

    cache.leafBySku.set(sku, {
      inventoryItemId: item.inventoryItemId,
      locationId: leafLocationId,
    });
    cache.leafByItemId.set(item.inventoryItemId, sku);
  }

  for (const item of soohiInventory) {
    if (!item.sku || item.sku.trim() === "") continue;
    const sku = item.sku.trim().toUpperCase();

    cache.soohiBySku.set(sku, {
      inventoryItemId: item.inventoryItemId,
      locationId: soohiLocationId,
    });
    cache.soohiByItemId.set(item.inventoryItemId, sku);
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

module.exports = {
  buildCache,
  getSkuByLeafItemId,
  getSkuBySoohiItemId,
  getSoohiTargetBySku,
  getLeafTargetBySku,
};