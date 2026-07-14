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
module.exports = {
  getAccessToken,
  graphqlRequest,
  updateInventory,
   updateProductStatus,
  deleteVariants,
};