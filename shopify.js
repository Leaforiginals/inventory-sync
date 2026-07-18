const axios = require("axios");
const crypto = require("crypto");

// ================================
// Generate Access Token
// ================================
async function getAccessToken(shop, clientId, clientSecret) {
  const response = await axios.post(
    `https://${shop}/admin/oauth/access_token`,
    new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  return response.data.access_token;
}

// ================================
// Generic GraphQL Request
// ================================
async function graphqlRequest(shop, token, query, variables = {}) {
  const response = await axios.post(
    `https://${shop}/admin/api/2026-07/graphql.json`,
    {
      query,
      variables,
    },
    {
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
    }
  );

  return response.data;
}

// ================================
// Update Inventory Quantity
// ================================
async function updateInventory(shop, token, inventoryItemId, locationId, quantity) {
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
      referenceDocumentUri: "leaf-soohi-sync://auto-sync",
      quantities: [
        {
          inventoryItemId,
          locationId,
          quantity,
          changeFromQuantity: null,
        },
      ],
    },
    idempotencyKey: crypto.randomUUID(),
  };

  const response = await graphqlRequest(shop, token, mutation, variables);

  if (response.errors) {
    throw new Error(response.errors.map((e) => e.message).join("\n"));
  }

  const userErrors = response.data?.inventorySetQuantities?.userErrors;
  if (userErrors && userErrors.length > 0) {
    throw new Error(userErrors.map((e) => e.message).join("\n"));
  }

  return response.data.inventorySetQuantities.inventoryAdjustmentGroup;
}

// ================================
// Update Product Status (Active/Draft)
// ================================
async function updateProductStatus(shop, token, productId, status) {
  const mutation = `
    mutation productUpdate($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product {
          id
          status
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    product: {
      id: productId,
      status,
    },
  };

  const response = await graphqlRequest(shop, token, mutation, variables);

  if (response.errors) {
    throw new Error(response.errors.map((e) => e.message).join("\n"));
  }

  const userErrors = response.data?.productUpdate?.userErrors;
  if (userErrors && userErrors.length > 0) {
    throw new Error(userErrors.map((e) => e.message).join("\n"));
  }

  return response.data.productUpdate.product;
}

// ================================
// Delete Product Variants
// ================================
async function deleteVariants(shop, token, productId, variantIds) {
  const mutation = `
    mutation productVariantsBulkDelete($productId: ID!, $variantsIds: [ID!]!) {
      productVariantsBulkDelete(productId: $productId, variantsIds: $variantsIds) {
        product {
          id
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    productId,
    variantsIds: variantIds,
  };

  const response = await graphqlRequest(shop, token, mutation, variables);

  if (response.errors) {
    throw new Error(response.errors.map((e) => e.message).join("\n"));
  }

  const userErrors = response.data?.productVariantsBulkDelete?.userErrors;
  if (userErrors && userErrors.length > 0) {
    throw new Error(userErrors.map((e) => e.message).join("\n"));
  }

  return response.data.productVariantsBulkDelete.product;
}

// ================================
// Create a new variant on an existing product
// ================================
async function createVariantOnProduct(shop, token, productId, optionName, optionValue, sku, quantity, locationId) {
  const mutation = `
    mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkCreate(productId: $productId, variants: $variants) {
        productVariants {
          id
          inventoryItem {
            id
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    productId,
    variants: [
      {
        price: "1.00",
        optionValues: [{ optionName, name: optionValue }],
        inventoryItem: { sku, tracked: true },
      },
    ],
  };

  const response = await graphqlRequest(shop, token, mutation, variables);

  if (response.errors) {
    throw new Error(response.errors.map((e) => e.message).join("\n"));
  }

  const userErrors = response.data?.productVariantsBulkCreate?.userErrors;
  if (userErrors && userErrors.length > 0) {
    throw new Error(userErrors.map((e) => e.message).join("\n"));
  }

  const variant = response.data.productVariantsBulkCreate.productVariants[0];

  await updateInventory(shop, token, variant.inventoryItem.id, locationId, quantity);

  return variant;
}

// ================================
// Create a brand-new product with variants
// (Shopify auto-creates a default ₹0 variant on productCreate — we find it
// by matching option values, then update it with the correct SKU/price/qty)
// ================================
async function createNewProduct(shop, token, title, optionName, variantsData, locationId) {
  const productMutation = `
    mutation productCreate($product: ProductCreateInput!) {
      productCreate(product: $product) {
        product {
          id
          variants(first: 100) {
            edges {
              node {
                id
                selectedOptions {
                  name
                  value
                }
                inventoryItem {
                  id
                }
              }
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const productVariables = {
    product: {
      title,
      productOptions: [
        {
          name: optionName,
          values: variantsData.map((v) => ({ name: v.optionValue })),
        },
      ],
    },
  };

  const productResponse = await graphqlRequest(shop, token, productMutation, productVariables);

  if (productResponse.errors) {
    throw new Error(productResponse.errors.map((e) => e.message).join("\n"));
  }

  const productUserErrors = productResponse.data?.productCreate?.userErrors;
  if (productUserErrors && productUserErrors.length > 0) {
    throw new Error(productUserErrors.map((e) => e.message).join("\n"));
  }

  const newProductId = productResponse.data.productCreate.product.id;
  const autoVariants = productResponse.data.productCreate.product.variants.edges.map((e) => e.node);

  const bulkUpdateInput = [];
  const matchedInfo = [];

  for (const v of variantsData) {
    const match = autoVariants.find((av) =>
      av.selectedOptions.some((opt) => opt.name === optionName && opt.value === v.optionValue)
    );
    if (!match) continue;

    bulkUpdateInput.push({
      id: match.id,
      price: "1.00",
      inventoryItem: { sku: v.sku, tracked: true },
    });
    matchedInfo.push({
      sku: v.sku,
      quantity: v.quantity,
      inventoryItemId: match.inventoryItem.id,
      variantId: match.id,
    });
  }

  const updateMutation = `
    mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        product {
          id
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const updateResponse = await graphqlRequest(shop, token, updateMutation, {
    productId: newProductId,
    variants: bulkUpdateInput,
  });

  if (updateResponse.errors) {
    throw new Error(updateResponse.errors.map((e) => e.message).join("\n"));
  }

  const updateUserErrors = updateResponse.data?.productVariantsBulkUpdate?.userErrors;
  if (updateUserErrors && updateUserErrors.length > 0) {
    throw new Error(updateUserErrors.map((e) => e.message).join("\n"));
  }

  for (const info of matchedInfo) {
    await updateInventory(shop, token, info.inventoryItemId, locationId, info.quantity);
  }

  const createdVariants = matchedInfo.map((info) => ({
    id: info.variantId,
    inventoryItem: { id: info.inventoryItemId },
  }));

  return { productId: newProductId, variants: createdVariants };
}

module.exports = {
  getAccessToken,
  graphqlRequest,
  updateInventory,
  updateProductStatus,
  deleteVariants,
  createVariantOnProduct,
  createNewProduct,
};