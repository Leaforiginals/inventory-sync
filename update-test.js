require("dotenv").config();
const crypto = require("crypto");

const { getAccessToken, graphqlRequest } = require("./shopify");

async function main() {
  try {
    console.log("======================================");
    console.log(" Inventory Update Test");
    console.log("======================================");

    const token = await getAccessToken(
      process.env.SOOHI_SHOP,
      process.env.SOOHI_CLIENT_ID,
      process.env.SOOHI_CLIENT_SECRET
    );

    console.log("✅ Token Generated\n");

    const mutation = `
      mutation InventorySet(
        $input: InventorySetQuantitiesInput!,
        $idempotencyKey: String!
      ) {
        inventorySetQuantities(input: $input)
          @idempotent(key: $idempotencyKey) {

          inventoryAdjustmentGroup {
            reason

            changes {
              name
              delta
              quantityAfterChange
            }
          }

          userErrors {
            field
            message
            code
          }
        }
      }
    `;

    const variables = {
      input: {
        name: "available",
        reason: "correction",
        referenceDocumentUri: "leaf-soohi-sync://manual-test",
        quantities: [
          {
            inventoryItemId: "gid://shopify/InventoryItem/53859990077728",
            locationId: "gid://shopify/Location/109999489312",
            quantity: 2,
            changeFromQuantity: null,
          },
        ],
      },
      idempotencyKey: crypto.randomUUID(),
    };

    const response = await graphqlRequest(
      process.env.SOOHI_SHOP,
      token,
      mutation,
      variables
    );

    console.log(JSON.stringify(response, null, 2));

  } catch (err) {

    if (err.response) {
      console.log(JSON.stringify(err.response.data, null, 2));
    } else {
      console.log(err.message);
    }

  }
}

main();