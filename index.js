const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

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

// Common function target store mein stock sync karne ke liye
async function updateTargetStore(targetStore, sku, newInventory) {
    const config = {
        headers: {
            'X-Shopify-Access-Token': targetStore.token,
            'Content-Type': 'application/json'
        }
    };

    try {
        // 1. SKU ke zariye target store mein product dhoondhein
        const searchUrl = `https://${targetStore.shopName}/admin/api/2024-04/products.json?sku=${sku}`;
        const searchRes = await axios.get(searchUrl, config);
        
        let inventoryItemId = null;
        let currentAvailable = null;
        let locationId = null;

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

        // 2. Target store ka current stock aur Location ID nikalna
        const inventoryUrl = `https://${targetStore.shopName}/admin/api/2024-04/inventory_levels.json?inventory_item_ids=${inventoryItemId}`;
        const invRes = await axios.get(inventoryUrl, config);
        
        if (invRes.data.inventory_levels.length > 0) {
            locationId = invRes.data.inventory_levels[0].location_id;
            currentAvailable = invRes.data.inventory_levels[0].available;
        }

        // ⭐ LOOP PREVENTER: Agar pehle se stock same hai, toh aage mat badho
        if (currentAvailable === newInventory) {
            console.log(`Loop Blocked: SKU ${sku} pehle se hi ${newInventory} par hai.`);
            return;
        }

        // 3. Stock set karna
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

// 🟢 Route 1: Leaf Originals Product Update
app.post('/webhook/leaf', async (req, res) => {
    res.sendStatus(200);
    
    // Product update webhook mein variants array aata hai
    const variants = req.body.variants;
    if (!variants || variants.length === 0) return;

    for (let variant of variants) {
        if (variant.sku) {
            console.log(`Leaf Originals variant check: ${variant.sku} -> Qty ${variant.inventory_quantity}`);
            await updateTargetStore(STORES.soohi, variant.sku, variant.inventory_quantity);
        }
    }
});

// 🔵 Route 2: Soohi.in Product Update
app.post('/webhook/soohi', async (req, res) => {
    res.sendStatus(200);
    
    const variants = req.body.variants;
    if (!variants || variants.length === 0) return;

    for (let variant of variants) {
        if (variant.sku) {
            console.log(`Soohi.in variant check: ${variant.sku} -> Qty ${variant.inventory_quantity}`);
            await updateTargetStore(STORES.leaf, variant.sku, variant.inventory_quantity);
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sync Server running on port ${PORT}`));