// src/utils/pagination.js

const MAX_LIMIT = 100;

/**
 * Parse and sanitise page/limit query params.
 * Clamps limit to [1, MAX_LIMIT] and page to >= 1.
 */
const parsePagination = (rawPage, rawLimit, defaultLimit = 10) => {
  let page = parseInt(rawPage, 10);
  let limit = parseInt(rawLimit, 10);

  if (!Number.isFinite(page) || page < 1) page = 1;
  if (!Number.isFinite(limit) || limit < 1) limit = defaultLimit;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  return { page, limit, offset: (page - 1) * limit };
};

const paginate = async (queryBuilder, { page = 1, limit = 10 }) => {
  const offset = (page - 1) * limit;
  
  // Clone the query to get total count
  const countQuery = queryBuilder.clone();
  
  // Get total count
  const [{ total }] = await countQuery
    .clearSelect()
    .clearOrder()
    .count('* as total');
  
  // Apply pagination to original query
  const data = await queryBuilder
    .offset(offset)
    .limit(limit);
  
  return {
    data,
    pagination: {
      total: parseInt(total),
      page: parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(total / limit),
      hasNext: page < Math.ceil(total / limit),
      hasPrev: page > 1
    }
  };
};

module.exports = { paginate, parsePagination };