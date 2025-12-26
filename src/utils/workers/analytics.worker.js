// utils/workers/analytics.worker.js
const { parentPort } = require('worker_threads');
const knex = require('knex');
const path = require('path');

// Load environment variables if needed
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

// Create Knex instance for the worker
const db = knex({
  client: 'mysql2',
  connection: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'your_database',
    charset: 'utf8mb4',
  },
  pool: {
    min: 1,
    max: 2, // Smaller pool for worker
  },
  debug: false // Disable debug in worker for performance
});

// Helper function to convert BigInt to String
const serializeBigInt = (data) => {
  if (data === null || data === undefined) {
    return data;
  }
  
  if (typeof data === 'bigint') {
    return data.toString();
  }
  
  if (Array.isArray(data)) {
    return data.map(serializeBigInt);
  }
  
  if (typeof data === 'object' && data.constructor === Object) {
    const newObj = {};
    for (const key in data) {
      newObj[key] = serializeBigInt(data[key]);
    }
    return newObj;
  }
  
  return data;
};

// Heavy computation functions
const computeUserGrowth = async (months = 12) => {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - months);
  
  // Get user counts grouped by month
  const users = await db('user')
    .select(
      db.raw('DATE_FORMAT(createdAt, "%Y-%m") as month'),
      db.raw('COUNT(*) as count')
    )
    .where('createdAt', '>=', startDate)
    .groupByRaw('DATE_FORMAT(createdAt, "%Y-%m")')
    .orderBy('month', 'asc');
  
  // Create a map of all months in the range
  const monthlyData = {};
  const allMonths = [];
  
  for (let i = months - 1; i >= 0; i--) {
    const date = new Date();
    date.setMonth(date.getMonth() - i);
    const monthKey = date.toISOString().slice(0, 7);
    allMonths.push(monthKey);
    monthlyData[monthKey] = 0;
  }
  
  // Fill in actual data
  users.forEach(user => {
    const monthKey = user.month;
    if (monthlyData[monthKey] !== undefined) {
      monthlyData[monthKey] = parseInt(user.count);
    }
  });
  
  // Convert to array format
  const result = allMonths.map(monthKey => ({
    month: monthKey,
    count: monthlyData[monthKey]
  }));
  
  return result;
};

const computeHouseStatistics = async () => {
  // Get total houses
  const totalHouses = await db('house')
    .count('* as count')
    .first()
    .then(r => parseInt(r.count));

  // Get active houses
  const activeHouses = await db('house')
    .where('active', true)
    .count('* as count')
    .first()
    .then(r => parseInt(r.count));

  // Get houses with flats
  const housesWithFlats = await db('house as h')
    .join('flat as f', 'h.id', 'f.house_id')
    .distinct('h.id')
    .count('* as count')
    .first()
    .then(r => parseInt(r.count));

  // Get houses with caretakers
  const housesWithCaretakers = await db('house as h')
    .join('caretakerassignment as ca', 'h.id', 'ca.houseId')
    .distinct('h.id')
    .count('* as count')
    .first()
    .then(r => parseInt(r.count));

  // Get recent houses with details
  const recentHouses = await db('house as h')
    .leftJoin('user as u', 'h.ownerId', 'u.id')
    .leftJoin('flat as f', 'h.id', 'f.house_id')
    .leftJoin('caretakerassignment as ca', 'h.id', 'ca.houseId')
    .select(
      'h.*',
      'u.name as owner_name',
      'u.email as owner_email',
      db.raw('COUNT(DISTINCT f.id) as flat_count'),
      db.raw('COUNT(DISTINCT ca.caretakerId) as caretaker_count')
    )
    .groupBy('h.id')
    .orderBy('h.createdAt', 'desc')
    .limit(10);

  return {
    totalHouses,
    activeHouses,
    inactiveHouses: totalHouses - activeHouses,
    housesWithFlats,
    housesWithCaretakers,
    recentHouses: recentHouses.map(house => ({
      id: house.id,
      uuid: house.uuid,
      address: house.address,
      active: house.active,
      flatCount: house.flat_count,
      caretakerCount: house.caretaker_count,
      owner: {
        name: house.owner_name,
        email: house.owner_email
      },
      createdAt: house.createdAt
    }))
  };
};

const computeFinancialMetrics = async () => {
  // This would connect to payment records
  // For now, return mock/stub data
  return {
    totalRevenue: 0,
    pendingPayments: 0,
    collectedThisMonth: 0,
    outstandingBalance: 0
  };
};

const computeRoleDistribution = async () => {
  const roles = await db('role as r')
    .leftJoin('user as u', 'r.id', 'u.roleId')
    .where('u.status', 'active')
    .orWhereNull('u.id')
    .select(
      'r.id',
      'r.name',
      'r.slug',
      db.raw('COUNT(DISTINCT u.id) as user_count')
    )
    .groupBy('r.id', 'r.name', 'r.slug')
    .orderBy('r.rank', 'desc');

  return roles.map(role => ({
    role: role.name,
    count: parseInt(role.user_count),
    slug: role.slug
  }));
};

const computeSystemOverview = async () => {
  const [
    userGrowth,
    houseStats,
    roleDistribution
  ] = await Promise.all([
    computeUserGrowth(6), // Last 6 months
    computeHouseStatistics(),
    computeRoleDistribution()
  ]);

  // Get total counts
  const totalUsers = await db('user')
    .count('* as count')
    .first()
    .then(r => parseInt(r.count));

  const activeUsers = await db('user')
    .where('status', 'active')
    .count('* as count')
    .first()
    .then(r => parseInt(r.count));

  const totalNotifications = await db('notification')
    .count('* as count')
    .first()
    .then(r => parseInt(r.count));

  const recentActivity = await db('user')
    .where('lastLoginAt', '>=', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)) // Last 7 days
    .count('* as count')
    .first()
    .then(r => parseInt(r.count));

  return {
    userGrowth,
    houseStats,
    roleDistribution,
    summary: {
      totalUsers,
      activeUsers,
      totalNotifications,
      recentActivity,
      uptime: '99.9%',
      databaseHealth: 'healthy',
      serverLoad: 'low'
    }
  };
};

// Task router
parentPort.on('message', async ({ taskId, task, data }) => {
  try {
    let result;
    
    switch (task) {
      case 'userGrowth':
        result = await computeUserGrowth(data?.months || 12);
        break;
        
      case 'houseStats':
        result = await computeHouseStatistics();
        break;
        
      case 'financialMetrics':
        result = await computeFinancialMetrics();
        break;
        
      case 'roleDistribution':
        result = await computeRoleDistribution();
        break;
        
      case 'systemOverview':
        result = await computeSystemOverview();
        break;
        
      default:
        throw new Error(`Unknown task: ${task}`);
    }
    
    // Serialize BigInt values before sending
    const serializedResult = serializeBigInt(result);
    
    parentPort.postMessage({ 
      taskId, 
      data: serializedResult,
      success: true 
    });
  } catch (error) {
    console.error(`Worker error in task ${task}:`, error);
    parentPort.postMessage({ 
      taskId, 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      success: false
    });
  }
});

// Handle worker shutdown
process.on('SIGTERM', async () => {
  console.log('Worker received SIGTERM, cleaning up...');
  await db.destroy();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Worker received SIGINT, cleaning up...');
  await db.destroy();
  process.exit(0);
});

// Handle uncaught errors
process.on('uncaughtException', async (error) => {
  console.error('Uncaught exception in worker:', error);
  await db.destroy();
  process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
  console.error('Unhandled rejection in worker:', reason);
  await db.destroy();
  process.exit(1);
});