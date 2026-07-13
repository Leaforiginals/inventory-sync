require("dotenv").config();
const { getAccessToken, graphqlRequest } = require("./shopify");

const RENDER_URL = "https://inventory-sync-1.onrender.com";

async function registerWebhook(shop, token, topic, callbackUrl) {
  const mutation = `
    mutation webhookSubscriptionCreate(
      $topic: WebhookSubscriptionTopic!,
      $webhookSubscription: WebhookSubscriptionInput!
    ) {
      webhookSubscriptionCreate(
        topic: $topic,
        webhookSubscription: $webhookSubscription
      ) {
        webhookSubscription {
          id
          callbackUrl
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    topic,
    webhookSubscription: {
      callbackUrl,
      format: "JSON",
    },
  };

  const response = await graphqlRequest(shop, token, mutation, variables);
  console.log(JSON.stringify(response, null, 2));
}

async function main() {
  const leafToken = await getAccessToken(
    process.env.LEAF_SHOP,
    process.env.LEAF_CLIENT_ID,
    process.env.LEAF_CLIENT_SECRET
  );

  console.log("Registering Leaf webhook...");
  await registerWebhook(
    process.env.LEAF_SHOP,
    leafToken,
    "INVENTORY_LEVELS_UPDATE",
    `${RENDER_URL}/webhooks/leaf`
  );

  const soohiToken = await getAccessToken(
    process.env.SOOHI_SHOP,
    process.env.SOOHI_CLIENT_ID,
    process.env.SOOHI_CLIENT_SECRET
  );

  console.log("Registering Soohi webhook...");
  await registerWebhook(
    process.env.SOOHI_SHOP,
    soohiToken,
    "INVENTORY_LEVELS_UPDATE",
    `${RENDER_URL}/webhooks/soohi`
  );
}

main();