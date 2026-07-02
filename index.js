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
    console.log("========== WEBHOOK RECEIVED ==========");

    const product = req.body;

    console.log("Leaf Product:", product.title);

    if (!product.variants) {
      console.log("No variants found.");
      return res.sendStatus(200);
    }

    console.log("=== ENV CHECK ===");
    console.log("STORE =", process.env.SOOHI_STORE_URL);
    console.log("TOKEN EXISTS =", !!process.env.SOOHI_ACCESS_TOKEN);
    console.log(
      "TOKEN PREFIX =",
      process.env.SOOHI_ACCESS_TOKEN
        ? process.env.SOOHI_ACCESS_TOKEN.substring(0, 10)
        : "NOT FOUND"
    );

    const response = await axios.get(
      `https://${process.env.SOOHI_STORE_URL}/admin/api/2025-07/products.json?limit=250`,
      {
        headers: {
          "X-Shopify-Access-Token": process.env.SOOHI_ACCESS_TOKEN,
        },
      }
    );

    for (const variant of product.variants) {
      const sku = variant.sku;
      const qty = variant.inventory_quantity;

      console.log("--------------------------------");
      console.log("Searching SKU:", sku);
      console.log("Quantity:", qty);

      let matchedVariant = null;

      for (const p of response.data.products) {
        for (const v of p.variants) {
          if (v.sku === sku) {
            matchedVariant = v;
            break;
          }
        }

        if (matchedVariant) break;
      }

      if (!matchedVariant) {
        console.log("SKU NOT FOUND:", sku);
        continue;
      }

      console.log("SKU FOUND");

      const inventoryItemId = matchedVariant.inventory_item_id;

      const levelResponse = await axios.get(
        `https://${process.env.SOOHI_STORE_URL}/admin/api/2025-07/inventory_levels.json?inventory_item_ids=${inventoryItemId}`,
        {
          headers: {
            "X-Shopify-Access-Token": process.env.SOOHI_ACCESS_TOKEN,
          },
        }
      );

      if (levelResponse.data.inventory_levels.length === 0) {
        console.log("Inventory level not found.");
        continue;
      }

      const locationId =
        levelResponse.data.inventory_levels[0].location_id;

      await axios.post(
        `https://${process.env.SOOHI_STORE_URL}/admin/api/2025-07/inventory_levels/set.json`,
        {
          location_id: locationId,
          inventory_item_id: inventoryItemId,
          available: qty,
        },
        {
          headers: {
            "X-Shopify-Access-Token": process.env.SOOHI_ACCESS_TOKEN,
            "Content-Type": "application/json",
          },
        }
      );

      console.log(`Updated SKU ${sku} → ${qty}`);
    }

    res.sendStatus(200);
  } catch (error) {
    console.log("========== ERROR ==========");

    if (error.response) {
      console.log(error.response.status);
      console.log(error.response.data);
    } else {
      console.log(error.message);
    }

    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});