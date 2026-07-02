const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

// CONFIGURATION: Apne dono stores ki details yahan bhariye
const STORES = {
    leaf: {
        shopName: 'YOUR_LEAF_ORIGINALS_STORE_NAME.myshopify.com',
        token: 'YOUR_LEAF_ORIGINALS_ADMIN_API_TOKEN'
    },
    soohi: {
        shopName: 'YOUR_SOOHI_STORE_NAME.myshopify.com',
        token: 'YOUR_SOOHI_ADMIN_API_TOKEN'
    }
};

// Common function dusre store mein SKU ke mutabik stock update karne ke liye
async function updateTargetStore(targetStore, sku, newInventory) {
    const config = {
        headers: {
            'X-Shopify-Access-Token': targetStore.token,
            'Content-Type': 'application/json'
        }
    };

    try {
        // 1. SKU ke zariye target store mein Inventory Item ID dhoondhein
        const searchUrl = `https://${targetStore.shopName}/admin/api/2024-04/products.json?sku=${sku}`;
        const searchRes = await axios.get(searchUrl, config);
        
        // Pure store mein find karein kaun sa variant is SKU se match karta hai
        let inventoryItemId = null;
        let currentAvailable = null;
        let locationId = null;

        // Yahan hum product variants ko scan karke target inventoryItemId nikalenge
        for (let product of searchRes.data.products) {
            for (let variant of product.variants) {
                if (variant.sku === sku) {
                    inventoryItemId = variant.inventory_item_id;
                    break;
                }
            }
        }

        if (!inventoryItemId) {
            console.log(`SKU ${sku} target store mein nahi mila.`);
            return;
        }

        // 2. Target store ki pehli Location ID aur current stock nikalne ke liye request
        const inventoryUrl = `https://${targetStore.shopName}/admin/api/2024-04/inventory_levels.json?inventory_item_ids=${inventoryItemId}`;
        const invRes = await axios.get(inventoryUrl, config);
        
        if (invRes.data.inventory_levels.length > 0) {
            locationId = invRes.data.inventory_levels[0].location_id;
            currentAvailable = invRes.data.inventory_levels[0].available;
        }

        // ⭐ LOOP PREVENTER: Agar target store ka stock pehle se hi same hai, toh aage mat badho!
        if (currentAvailable === newInventory) {
            console.log(`Loop Blocked: SKU ${sku} ka stock pehle se hi ${newInventory} hai.`);
            return;
        }

        // 3. Agar stock alag hai, toh use set (sync) kar do
        const setUrl = `https://${targetStore.shopName}/admin/api/2024-04/inventory_levels/set.json`;
        await axios.post(setUrl, {
            location_id: locationId,
            inventory_item_id: inventoryItemId,
            available: newInventory
        }, config);

        console.log(`Successfully Synced: SKU ${sku} updated to ${newInventory}`);

    } catch (error) {
        console.error("Sync Error:", error.response ? error.response.data : error.message);
    }
}

// 🟢 Route 1: Jab Leaf Originals mein change ho (Updates Soohi.in)
app.post('/webhook/leaf', async (req, res) => {
    res.sendStatus(200); // Shopify ko turant OK bolo taaki woh wait na kare
    
    const { sku, inventory_quantity } = req.body; // Shopify Webhook data
    if (!sku) return;

    console.log(`Leaf Originals updated: SKU ${sku} -> Qty ${inventory_quantity}`);
    await updateTargetStore(STORES.soohi, sku, inventory_quantity);
});

// 🔵 Route 2: Jab Soohi.in mein change ho (Updates Leaf Originals)
app.post('/webhook/soohi', async (req, res) => {
    res.sendStatus(200);
    
    const { sku, inventory_quantity } = req.body;
    if (!sku) return;

    console.log(`Soohi.in updated: SKU ${sku} -> Qty ${inventory_quantity}`);
    await updateTargetStore(STORES.leaf, sku, inventory_quantity);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sync Server running on port ${PORT}`));