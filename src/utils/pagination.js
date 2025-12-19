// src/utils/pagination.js
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

module.exports = { paginate };