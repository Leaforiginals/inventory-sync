require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Inventory Sync Server Running");
});

app.post("/webhook", async (req, res) => {
  try {
    console.log("Webhook received!");

    const product = req.body;

    console.log("Leaf product:", product.title);
    console.log(JSON.stringify(req.body, null, 2));

    if (!product.variants) {
      return res.sendStatus(200);
    }

    for (const variant of product.variants) {

      const sku = variant.sku;
      const qty = variant.inventory_quantity;

      console.log("Leaf SKU =", sku);
      console.log("Searching SKU:", sku);
      console.log("Quantity:", qty);

 const response = await axios.get(
  `https://${process.env.SOOHI_STORE_URL}/admin/api/2025-07/products.json?limit=250`,
  {
    headers: {
      "X-Shopify-Access-Token": process.env.SOOHI_ACCESS_TOKEN
    }
  }
);

      let matchedVariant = null;

      for (const product of response.data.products) {
        for (const v of product.variants) {

          console.log("Soohi SKU =", v.sku);

          if (v.sku === sku) {
            matchedVariant = v;
            break;
          }
        }

        if (matchedVariant) break;
      }

      if (!matchedVariant) {
        console.log("SKU not found in Soohi:", sku);
        continue;
      }

      console.log("Found exact SKU in Soohi");

      const inventoryItemId = matchedVariant.inventory_item_id;

      const levelResponse = await axios.get(
        `https://${process.env.SOOHI_STORE_URL}/admin/api/2025-07/inventory_levels.json?inventory_item_ids=${inventoryItemId}`,
        {
          headers: {
            "X-Shopify-Access-Token": process.env.SOOHI_ACCESS_TOKEN
          }
        }
      );

      if (levelResponse.data.inventory_levels.length === 0) {
        console.log("Inventory level not found");
        continue;
      }

      const locationId =
        levelResponse.data.inventory_levels[0].location_id;

      await axios.post(
        `https://${process.env.SOOHI_STORE_URL}/admin/api/2025-07/inventory_levels/set.json`,
        {
          location_id: locationId,
          inventory_item_id: inventoryItemId,
          available: qty
        },
        {
          headers: {
            "X-Shopify-Access-Token": process.env.SOOHI_ACCESS_TOKEN,
            "Content-Type": "application/json"
          }
        }
      );

      console.log(`Updated Soohi SKU ${sku} to ${qty}`);
    }

    res.sendStatus(200);

  } catch (error) {
    console.log(error.response?.data || error.message);
    res.sendStatus(500);
  }
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
