/**
 * Database Helper for Tax Rates (web API)
 * Uses service IMS token + Runtime namespace (same as create-tax-rate / auth-runtime).
 */

const libDb = require('@adobe/aio-lib-db');
const { ObjectId } = require('bson');
const { getDefaultRegion, getTaxRatesCollection } = require('../lib/config');

const COLLECTION_NAME = getTaxRatesCollection();
const DEFAULT_REGION = getDefaultRegion();

/**
 * @param {{ bearerToken: string, namespace: string }} dbCtx
 * @param {string} region
 */
async function initDbWithCtx(dbCtx, region = DEFAULT_REGION) {
  const { bearerToken, namespace } = dbCtx;
  try {
    const db = await libDb.init({ token: bearerToken, region, ow: { namespace } });
    const client = await db.connect();
    const collectionName = dbCtx?.collectionName || COLLECTION_NAME;
    const collection = await client.collection(collectionName);
    return { client, collection };
  } catch (error) {
    if (error && error.name === 'DbError') {
      throw new Error(`Database error: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Create indexes for optimized queries
 * Should be called once during setup
 */
async function createIndexes(region = DEFAULT_REGION, dbCtx) {
  let client;
  try {
    const { client: dbClient, collection } = await initDbWithCtx(dbCtx, region);
    client = dbClient;
    
    // Create compound index for common queries (country, state, zipcode)
    await collection.createIndex({ 
      tax_country_id: 1, 
      tax_region_id: 1, 
      tax_postcode: 1 
    });
    
    // Create index for city searches
    await collection.createIndex({ city: 1 });
    
    // Create index for rate lookups
    await collection.createIndex({ rate: 1 });
    
    // Create index for status filtering
    await collection.createIndex({ status: 1 });
    
    console.log('Indexes created successfully');
  } catch (error) {
    console.error('Error creating indexes:', error);
    throw error;
  } finally {
    if (client) {
      await client.close();
    }
  }
}

/**
 * Insert a single tax rate
 * @param {Object} taxRate - Tax rate document
 * @param {string} region - Database region
 * @returns {Promise<Object>} Insert result
 */
async function insertTaxRate(taxRate, region = DEFAULT_REGION, dbCtx) {
  let client;
  try {
    const { client: dbClient, collection } = await initDbWithCtx(dbCtx, region);
    client = dbClient;
    
    // Add timestamps
    const document = {
      ...taxRate,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    const result = await collection.insertOne(document);
    return {
      success: true,
      insertedId: result.insertedId,
      document: { ...document, _id: result.insertedId }
    };
  } catch (error) {
    if (error && error.name === 'DbError') {
      throw new Error(`Database error: ${error.message}`);
    }
    throw error;
  } finally {
    if (client) {
      await client.close();
    }
  }
}

/**
 * Insert multiple tax rates
 * @param {Array} taxRates - Array of tax rate documents
 * @param {string} region - Database region
 * @returns {Promise<Object>} Insert result
 */
async function insertManyTaxRates(taxRates, region = DEFAULT_REGION, dbCtx) {
  let client;
  try {
    const { client: dbClient, collection } = await initDbWithCtx(dbCtx, region);
    client = dbClient;
    
    const now = new Date().toISOString();
    const documents = taxRates.map(rate => ({
      ...rate,
      created_at: now,
      updated_at: now
    }));
    
    const result = await collection.insertMany(documents);
    return {
      success: true,
      insertedCount: result.insertedCount,
      insertedIds: result.insertedIds
    };
  } catch (error) {
    if (error && error.name === 'DbError') {
      throw new Error(`Database error: ${error.message}`);
    }
    throw error;
  } finally {
    if (client) {
      await client.close();
    }
  }
}

/**
 * Find tax rates with optional filters and pagination
 * @param {Object} filter - MongoDB filter object
 * @param {Object} options - Query options (limit, skip, sort, projection)
 * @param {string} region - Database region
 * @returns {Promise<Array>} Array of tax rates
 */
async function findTaxRates(filter = {}, options = {}, region = DEFAULT_REGION, dbCtx) {
  let client;
  try {
    const { client: dbClient, collection } = await initDbWithCtx(dbCtx, region);
    client = dbClient;
    
    const { limit, skip, sort, projection } = options;
    let cursor = collection.find(filter);
    
    if (projection) {
      cursor = cursor.project(projection);
    }
    
    if (sort) {
      cursor = cursor.sort(sort);
    }
    
    if (skip) {
      cursor = cursor.skip(skip);
    }
    
    if (limit) {
      cursor = cursor.limit(limit);
    }
    
    const results = await cursor.toArray();
    return results;
  } catch (error) {
    if (error && error.name === 'DbError') {
      throw new Error(`Database error: ${error.message}`);
    }
    throw error;
  } finally {
    if (client) {
      await client.close();
    }
  }
}

/**
 * Find a single tax rate
 * @param {Object} filter - MongoDB filter object
 * @param {string} region - Database region
 * @returns {Promise<Object|null>} Tax rate document or null
 */
async function findOneTaxRate(filter, region = DEFAULT_REGION, dbCtx) {
  let client;
  try {
    const { client: dbClient, collection } = await initDbWithCtx(dbCtx, region);
    client = dbClient;
    
    const result = await collection.findOne(filter);
    return result;
  } catch (error) {
    if (error && error.name === 'DbError') {
      throw new Error(`Database error: ${error.message}`);
    }
    throw error;
  } finally {
    if (client) {
      await client.close();
    }
  }
}

/**
 * Count tax rates matching filter
 * @param {Object} filter - MongoDB filter object
 * @param {string} region - Database region
 * @returns {Promise<number>} Count of matching documents
 */
async function countTaxRates(filter = {}, region = DEFAULT_REGION, dbCtx) {
  let client;
  try {
    const { client: dbClient, collection } = await initDbWithCtx(dbCtx, region);
    client = dbClient;
    
    const cursor = collection.find(filter);
    const results = await cursor.toArray();
    return results.length;
  } catch (error) {
    if (error && error.name === 'DbError') {
      throw new Error(`Database error: ${error.message}`);
    }
    throw error;
  } finally {
    if (client) {
      await client.close();
    }
  }
}

/**
 * Update a single tax rate
 * @param {Object} filter - MongoDB filter object
 * @param {Object} update - MongoDB update object
 * @param {string} region - Database region
 * @returns {Promise<Object>} Update result
 */
async function updateTaxRate(filter, update, region = DEFAULT_REGION, dbCtx) {
  let client;
  try {
    const { client: dbClient, collection } = await initDbWithCtx(dbCtx, region);
    client = dbClient;
    
    // Add updated_at timestamp
    const updateDoc = {
      ...update,
      $set: {
        ...(update.$set || {}),
        updated_at: new Date().toISOString()
      }
    };
    
    const result = await collection.updateOne(filter, updateDoc);
    return {
      success: result.modifiedCount > 0,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount
    };
  } catch (error) {
    if (error && error.name === 'DbError') {
      throw new Error(`Database error: ${error.message}`);
    }
    throw error;
  } finally {
    if (client) {
      await client.close();
    }
  }
}

/**
 * Update multiple tax rates
 * @param {Object} filter - MongoDB filter object
 * @param {Object} update - MongoDB update object
 * @param {string} region - Database region
 * @returns {Promise<Object>} Update result
 */
async function updateManyTaxRates(filter, update, region = DEFAULT_REGION, dbCtx) {
  let client;
  try {
    const { client: dbClient, collection } = await initDbWithCtx(dbCtx, region);
    client = dbClient;
    
    // Add updated_at timestamp
    const updateDoc = {
      ...update,
      $set: {
        ...(update.$set || {}),
        updated_at: new Date().toISOString()
      }
    };
    
    const result = await collection.updateMany(filter, updateDoc);
    return {
      success: result.modifiedCount > 0,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount
    };
  } catch (error) {
    if (error && error.name === 'DbError') {
      throw new Error(`Database error: ${error.message}`);
    }
    throw error;
  } finally {
    if (client) {
      await client.close();
    }
  }
}

/**
 * Replace a tax rate document
 * @param {Object} filter - MongoDB filter object
 * @param {Object} replacement - Replacement document
 * @param {string} region - Database region
 * @returns {Promise<Object>} Replace result
 */
async function replaceTaxRate(filter, replacement, region = DEFAULT_REGION, dbCtx) {
  let client;
  try {
    const { client: dbClient, collection } = await initDbWithCtx(dbCtx, region);
    client = dbClient;
    
    // Preserve created_at if exists, update updated_at
    const document = {
      ...replacement,
      updated_at: new Date().toISOString()
    };
    
    const result = await collection.replaceOne(filter, document);
    return {
      success: result.modifiedCount > 0,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount
    };
  } catch (error) {
    if (error && error.name === 'DbError') {
      throw new Error(`Database error: ${error.message}`);
    }
    throw error;
  } finally {
    if (client) {
      await client.close();
    }
  }
}

/**
 * Delete a single tax rate
 * @param {Object} filter - MongoDB filter object
 * @param {string} region - Database region
 * @returns {Promise<Object>} Delete result
 */
async function deleteTaxRate(filter, region = DEFAULT_REGION, dbCtx) {
  let client;
  try {
    const { client: dbClient, collection } = await initDbWithCtx(dbCtx, region);
    client = dbClient;
    
    const result = await collection.deleteOne(filter);
    return {
      success: result.deletedCount > 0,
      deletedCount: result.deletedCount
    };
  } catch (error) {
    if (error && error.name === 'DbError') {
      throw new Error(`Database error: ${error.message}`);
    }
    throw error;
  } finally {
    if (client) {
      await client.close();
    }
  }
}

/**
 * Delete multiple tax rates
 * @param {Object} filter - MongoDB filter object
 * @param {string} region - Database region
 * @returns {Promise<Object>} Delete result
 */
async function deleteManyTaxRates(filter, region = DEFAULT_REGION, dbCtx) {
  let client;
  try {
    const { client: dbClient, collection } = await initDbWithCtx(dbCtx, region);
    client = dbClient;
    
    const result = await collection.deleteMany(filter);
    return {
      success: result.deletedCount > 0,
      deletedCount: result.deletedCount
    };
  } catch (error) {
    if (error && error.name === 'DbError') {
      throw new Error(`Database error: ${error.message}`);
    }
    throw error;
  } finally {
    if (client) {
      await client.close();
    }
  }
}

/**
 * Find tax rate by location (country, state, zipcode, city)
 * @param {Object} location - Location object with country, state, zipcode, city
 * @param {string} region - Database region
 * @returns {Promise<Object|null>} Tax rate document or null
 */
async function findTaxRateByLocation(location, region = DEFAULT_REGION, dbCtx) {
  const { country, state, zipcode, city } = location;
  
  // Build filter
  const filter = {
    tax_country_id: country
  };
  
  if (state) {
    filter.tax_region_id = state;
  }
  
  if (zipcode) {
    filter.tax_postcode = zipcode;
  }
  
  if (city) {
    filter.city = city;
  }
  
  return await findOneTaxRate(filter, region, dbCtx);
}

/**
 * Convert string _id to ObjectId for queries
 * @param {string} idString - String representation of _id
 * @returns {ObjectId} ObjectId instance
 */
function toObjectId(idString) {
  try {
    return new ObjectId(idString);
  } catch (error) {
    throw new Error(`Invalid ObjectId: ${idString}`);
  }
}

module.exports = {
  initDbWithCtx,
  createIndexes,
  insertTaxRate,
  insertManyTaxRates,
  findTaxRates,
  findOneTaxRate,
  countTaxRates,
  updateTaxRate,
  updateManyTaxRates,
  replaceTaxRate,
  deleteTaxRate,
  deleteManyTaxRates,
  findTaxRateByLocation,
  toObjectId,
  COLLECTION_NAME,
  DEFAULT_REGION
};

