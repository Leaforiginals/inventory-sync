const { getInventory } = require("./inventory");

async function compareInventory(
  leafShop,
  leafToken,
  leafLocationId,
  soohiShop,
  soohiToken,
  soohiLocationId
) {
  console.log("\nReading Leaf Inventory...");

  const leafInventory = await getInventory(
    leafShop,
    leafToken,
    leafLocationId
  );

  console.log("Leaf Variants:", leafInventory.length);

  console.log("\nReading Soohi Inventory...");

  const soohiInventory = await getInventory(
    soohiShop,
    soohiToken,
    soohiLocationId
  );

  console.log("Soohi Variants:", soohiInventory.length);

  console.log("\n=========== LEAF NON-EMPTY SKUs ===========");

  let leafCount = 0;

  for (const item of leafInventory) {
    if (item.sku && item.sku.trim() !== "") {
      leafCount++;
      console.log(
        item.productTitle,
        "=>",
        item.sku,
        "| Available:",
        item.availableQuantity
      );
    }
  }

  console.log("\nTotal Leaf SKUs:", leafCount);

  console.log("\n=========== SOOHI NON-EMPTY SKUs ===========");

  let soohiCount = 0;

  for (const item of soohiInventory) {
    if (item.sku && item.sku.trim() !== "") {
      soohiCount++;
      console.log(
        item.productTitle,
        "=>",
        item.sku,
        "| Available:",
        item.availableQuantity
      );
    }
  }

  console.log("\nTotal Soohi SKUs:", soohiCount);

  const soohiSkuMap = new Map();

  for (const item of soohiInventory) {
    if (item.sku && item.sku.trim() !== "") {
      soohiSkuMap.set(item.sku.trim().toUpperCase(), item);
    }
  }

  let matched = 0;

  console.log("\n=========== MATCHED SKUs ===========");

  for (const leaf of leafInventory) {
    if (!leaf.sku || leaf.sku.trim() === "") continue;

    const sku = leaf.sku.trim().toUpperCase();
    const soohi = soohiSkuMap.get(sku);

    if (soohi) {
      matched++;

      console.log("--------------------------------");
      console.log("SKU             :", sku);
      console.log("Leaf            :", leaf.productTitle);
      console.log("Leaf Available  :", leaf.availableQuantity);
      console.log("Soohi           :", soohi.productTitle);
      console.log("Soohi Available :", soohi.availableQuantity);
    }
  }

  console.log("\n==================================");
  console.log("Matched SKUs :", matched);
  console.log("==================================\n");
}

module.exports = {
  compareInventory,
};