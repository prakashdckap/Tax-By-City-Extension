/**
 * Database Helper for Tax Rates
 * Provides CRUD operations using App Builder Database Storage (aio-lib-db)
 */

const libDb = require('@adobe/aio-lib-db');
const { DbError } = require('@adobe/aio-lib-db');
const { ObjectId } = require('bson');

const COLLECTION_NAME = 'tax_rates';
const DEFAULT_REGION = 'amer'; // Change to 'emea' or 'apac' if needed

/**
 * Initialize database connection
 * @param {string} region - Database region (amer, emea, apac)
 * @returns {Promise<Object>} Database client and collection
 */
async function initDb(region = DEFAULT_REGION) {
  try {
    const db = await libDb.init({ region });
    const client = await db.connect();
    const collection = await client.collection(COLLECTION_NAME);
    return { client, collection };
  } catch (error) {
    if (error instanceof DbError) {
      throw new Error(`Database error: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Create indexes for optimized queries
 * Should be called once during setup
 */
async function createIndexes(region = DEFAULT_REGION) {
  let client;
  try {
    const { client: dbClient, collection } = await initDb(region);
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
async function insertTaxRate(taxRate, region = DEFAULT_REGION) {
  let client;
  try {
    const { client: dbClient, collection } = await initDb(region);
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
    if (error instanceof DbError) {
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
async function insertManyTaxRates(taxRates, region = DEFAULT_REGION) {
  let client;
  try {
    const { client: dbClient, collection } = await initDb(region);
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
    if (error instanceof DbError) {
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
async function findTaxRates(filter = {}, options = {}, region = DEFAULT_REGION) {
  let client;
  try {
    const { client: dbClient, collection } = await initDb(region);
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
    if (error instanceof DbError) {
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
async function findOneTaxRate(filter, region = DEFAULT_REGION) {
  let client;
  try {
    const { client: dbClient, collection } = await initDb(region);
    client = dbClient;
    
    const result = await collection.findOne(filter);
    return result;
  } catch (error) {
    if (error instanceof DbError) {
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
async function countTaxRates(filter = {}, region = DEFAULT_REGION) {
  let client;
  try {
    const { client: dbClient, collection } = await initDb(region);
    client = dbClient;
    
    const cursor = collection.find(filter);
    const results = await cursor.toArray();
    return results.length;
  } catch (error) {
    if (error instanceof DbError) {
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
async function updateTaxRate(filter, update, region = DEFAULT_REGION) {
  let client;
  try {
    const { client: dbClient, collection } = await initDb(region);
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
    if (error instanceof DbError) {
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
async function updateManyTaxRates(filter, update, region = DEFAULT_REGION) {
  let client;
  try {
    const { client: dbClient, collection } = await initDb(region);
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
    if (error instanceof DbError) {
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
async function replaceTaxRate(filter, replacement, region = DEFAULT_REGION) {
  let client;
  try {
    const { client: dbClient, collection } = await initDb(region);
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
    if (error instanceof DbError) {
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
async function deleteTaxRate(filter, region = DEFAULT_REGION) {
  let client;
  try {
    const { client: dbClient, collection } = await initDb(region);
    client = dbClient;
    
    const result = await collection.deleteOne(filter);
    return {
      success: result.deletedCount > 0,
      deletedCount: result.deletedCount
    };
  } catch (error) {
    if (error instanceof DbError) {
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
async function deleteManyTaxRates(filter, region = DEFAULT_REGION) {
  let client;
  try {
    const { client: dbClient, collection } = await initDb(region);
    client = dbClient;
    
    const result = await collection.deleteMany(filter);
    return {
      success: result.deletedCount > 0,
      deletedCount: result.deletedCount
    };
  } catch (error) {
    if (error instanceof DbError) {
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
async function findTaxRateByLocation(location, region = DEFAULT_REGION) {
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
  
  return await findOneTaxRate(filter, region);
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
  initDb,
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

