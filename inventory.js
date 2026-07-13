const { graphqlRequest } = require("./shopify");

async function getInventory(shop, token, locationId) {
  const inventory = [];

  let hasNextPage = true;
  let cursor = null;

  while (hasNextPage) {
    const query = `
      query GetProductVariants($cursor: String, $locationId: ID!) {
        productVariants(first: 250, after: $cursor) {
          pageInfo {
            hasNextPage
            endCursor
          }

          edges {
            node {
              id
              title
              sku

             product {
                id
                title
              }

              inventoryItem {
                id
                tracked

                inventoryLevel(locationId: $locationId) {
                  isActive

                  quantities(names: ["available"]) {
                    name
                    quantity
                  }
                }
              }
            }
          }
        }
      }
    `;

    const response = await graphqlRequest(shop, token, query, {
      cursor,
      locationId,
    });

    if (response.errors) {
      throw new Error(
        response.errors.map((error) => error.message).join("\n")
      );
    }

    const result = response.data?.productVariants;

    if (!result) {
      throw new Error("Shopify se product variants ka data nahi mila.");
    }

    for (const edge of result.edges) {
      const variant = edge.node;
      const level = variant.inventoryItem.inventoryLevel;

      const availableQuantity = level
        ? level.quantities.find((item) => item.name === "available")?.quantity ?? 0
        : null;

     inventory.push({
        productId: variant.product.id,
        productTitle: variant.product.title,
        variantTitle: variant.title,
        variantId: variant.id,
        inventoryItemId: variant.inventoryItem.id,
        sku: variant.sku,
        tracked: variant.inventoryItem.tracked,
        availableQuantity,
      });

    hasNextPage = result.pageInfo.hasNextPage;
    cursor = result.pageInfo.endCursor;
  }

  return inventory;
}

module.exports = {
  getInventory,
};