require("dotenv").config();

const { getAccessToken, graphqlRequest } = require("./shopify");

async function main() {
  try {
    console.log("====================================");
    console.log("Leaf Product Test");
    console.log("====================================");

    const token = await getAccessToken(
      process.env.LEAF_SHOP,
      process.env.LEAF_CLIENT_ID,
      process.env.LEAF_CLIENT_SECRET
    );

    console.log("✅ Token Generated\n");

const query = `
{
  locations(first: 20) {
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
      process.env.LEAF_SHOP,
      token,
      query
    );

    console.log(JSON.stringify(response, null, 2));

  } catch (err) {

    console.log(err.response?.data || err.message);

  }
}

main();