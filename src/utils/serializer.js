// src/utils/serializer.js
/**
 * Serialize data with BigInt support for JSON.stringify
 */
function serializeBigInt(data) {
  if (data === null || data === undefined) {
    return data;
  }
  
  return JSON.parse(JSON.stringify(data, (key, value) => {
    if (typeof value === 'bigint') {
      return value.toString();
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    return value;
  }));
}

/**
 * Middleware to handle BigInt serialization for all responses
 */
function bigIntSerializer(req, res, next) {
  const originalJson = res.json;
  
  res.json = function(data) {
    const serializedData = serializeBigInt(data);
    originalJson.call(this, serializedData);
  };
  
  next();
}

/**
 * Convert BigInt in database results
 */
function convertBigIntToString(obj) {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  if (typeof obj === 'bigint') {
    return obj.toString();
  }
  
  if (Array.isArray(obj)) {
    return obj.map(convertBigIntToString);
  }
  
  if (typeof obj === 'object' && obj.constructor === Object) {
    const newObj = {};
    for (const key in obj) {
      newObj[key] = convertBigIntToString(obj[key]);
    }
    return newObj;
  }
  
  return obj;
}

module.exports = {
  serializeBigInt,
  bigIntSerializer,
  convertBigIntToString
};