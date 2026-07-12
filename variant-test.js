require("dotenv").config();

const { getAccessToken, graphqlRequest } = require("./shopify");

async function main() {
  try {
    console.log("======================================");
    console.log(" Soohi Location Test");
    console.log("======================================");

    const token = await getAccessToken(
      process.env.SOOHI_SHOP,
      process.env.SOOHI_CLIENT_ID,
      process.env.SOOHI_CLIENT_SECRET
    );

    console.log("✅ Token Generated\n");

    const query = `
    {
      locations(first: 10) {
        edges {
          node {
            id
            name
            isActive
          }
        }
      }
    }
    `;

    const response = await graphqlRequest(
      process.env.SOOHI_SHOP,
      token,
      query
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