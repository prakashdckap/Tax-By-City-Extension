/**
 * DB connection debug action.
 * Verifies App Builder Database connection per docs:
 * - IMS token via Bearer header (preferred) or generateAccessToken(params) when include-ims-credentials: true
 * - libDb.init({ token, region }) with region matching app.config.yaml runtimeManifest.database.region
 * Returns: dbConnectionSuccessful, message, and details. No secrets in response.
 */
const { generateAccessToken } = require('@adobe/aio-sdk').Core.AuthClient;
const libDb = require('@adobe/aio-lib-db');

const DEFAULT_REGION = 'amer';

function getBearerToken(params) {
  const headers = params.__ow_headers || {};
  const auth = headers.authorization || headers.Authorization;
  if (auth && typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.substring(7).trim();
  }
  return null;
}

async function main(params) {
  const region = params.region || process.env.AIO_DB_REGION || DEFAULT_REGION;
  const bearerToken = getBearerToken(params);

  let result = {
    dbConnectionSuccessful: false,
    message: '',
    region,
    tokenSource: bearerToken ? 'Authorization Bearer header' : 'generateAccessToken(params)',
    step: null,
    errorDetails: null
  };

  try {
    let accessToken;
    if (bearerToken) {
      result.step = 'token_from_header';
      accessToken = bearerToken;
    } else {
      result.step = 'token';
      const token = await generateAccessToken(params);
      accessToken = token && token.access_token ? token.access_token : token;
    }
    result.step = 'init';
    const db = await libDb.init({ token: accessToken, region });
    result.step = 'connect';
    const client = await db.connect();
    result.step = 'collection';
    const collection = await client.collection('tax_rates');
    const sample = await collection.find({}).limit(1).toArray();
    await client.close();
    result.dbConnectionSuccessful = true;
    result.message = 'DB connection successful.';
    result.step = 'done';
    result.collectionReachable = true;
    result.sampleCount = Array.isArray(sample) ? sample.length : 0;
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: result
    };
  } catch (error) {
    result.message = 'DB connection failed.';
    result.errorDetails = {
      message: error && error.message,
      name: error && error.name,
      code: error && error.code,
      step: result.step
    };
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: result
    };
  }
}

exports.main = main;
