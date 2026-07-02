const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

// CONFIGURATION: Apne dono stores ki details yahan dhyan se bhariye
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

// Sahi function SKU ke mutabik target store mein stock update karne ke liye
async function updateTargetStore(targetStore, sku, newInventory) {
    const config = {
        headers: {
            'X-Shopify-Access-Token': targetStore.token,
            'Content-Type': 'application/json'
        }
    };

    try {
        // 1. GraphQL ke zariye target store mein Inventory Item ID aur Location ID ek sath dhoondhein
        const graphqlUrl = `https://${targetStore.shopName}/admin/api/2024-04/graphql.json`;
        
        const query = {
            query: `
            query {
              productVariants(first: 1, query: "sku:${sku}") {
                edges {
                  node {
                    inventoryItem {
                      id
                      inventoryLevels(first: 1) {
                        edges {
                          node {
                            location {
                              id
                            }
                            quantities(names: ["available"]) {
                              quantity
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }`
        };

        const searchRes = await axios.post(graphqlUrl, query, config);
        const edges = searchRes.data.data.productVariants.edges;

        if (edges.length === 0) {
            console.log(`SKU ${sku} target store mein nahi mila.`);
            return;
        }

        const inventoryNode = edges[0].node.inventoryItem;
        const inventoryItemId = inventoryNode.id.split('/').pop(); // Extract ID number
        
        const levelEdge = inventoryNode.inventoryLevels.edges[0];
        if (!levelEdge) {
            console.log(`SKU ${sku} ki koi location nahi mili.`);
            return;
        }

        const locationId = levelEdge.node.location.id.split('/').pop();
        const currentAvailable = levelEdge.node.quantities[0].quantity;

        // ⭐ LOOP PREVENTER: Agar target store ka stock pehle se hi same hai, toh aage mat badho!
        if (currentAvailable === newInventory) {
            console.log(`Loop Blocked: SKU ${sku} ka stock pehle se hi ${newInventory} hai.`);
            return;
        }

        // 2. Agar stock alag hai, toh use set (sync) kar do
        const setUrl = `https://${targetStore.shopName}/admin/api/2024-04/inventory_levels/set.json`;
        await axios.post(setUrl, {
            location_id: parseInt(locationId),
            inventory_item_id: parseInt(inventoryItemId),
            available: newInventory
        }, config);

        console.log(`Successfully Synced: SKU ${sku} updated to ${newInventory}`);

    } catch (error) {
        console.error("Sync Error:", error.response ? JSON.stringify(error.response.data) : error.message);
    }
}

// 🟢 Route 1: Leaf Originals Product Update
app.post('/webhook/leaf', async (req, res) => {
    res.sendStatus(200);
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

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Sync Server running on port ${PORT}`));