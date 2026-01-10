// utils/workers/houseOwnerAnalytics.worker.js
const { parentPort } = require('worker_threads');
const knex = require('knex');
const path = require('path');

// Load environment variables
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
    max: 2,
  },
  debug: false
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

// Calculate house owner dashboard data
const computeHouseOwnerDashboard = async (houseOwnerId, months = 12) => {
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - months);
  
  // Get all houses owned by the user
  const houses = await db('house')
    .where('ownerId', houseOwnerId)
    .select('id', 'name', 'address', 'active', 'createdAt');
  
  if (!houses || houses.length === 0) {
    return {
      summary: {
        totalHouses: 0,
        activeHouses: 0,
        inactiveHouses: 0,
        totalFlats: 0,
        vacantFlats: 0,
        occupiedFlats: 0,
        totalRenters: 0,
        activeRenters: 0,
        inactiveRenters: 0,
        assignedCaretakers: 0
      },
      rentCollectionProgress: {}, // Changed to object
      upcomingPayments: [],
      charts: {
        monthlyRentCollection: [],
        rentCollectionByHouse: [],
        flatOccupancy: { vacant: 0, occupied: 0 },
        expenseBreakdown: []
      },
      recentTransactions: [],
      houses: []
    };
  }
  
  const houseIds = houses.map(h => h.id);
  
  // Get all flats in these houses
  const flats = await db('flat')
    .whereIn('house_id', houseIds)
    .select('id', 'house_id', 'renter_id', 'number', 'name', 'rent_amount', 'rent_due_date');
  
  // Get flat statistics
  const flatStats = await db('flat')
    .whereIn('house_id', houseIds)
    .select(
      db.raw('COUNT(*) as total'),
      db.raw('SUM(CASE WHEN renter_id IS NULL THEN 1 ELSE 0 END) as vacant'),
      db.raw('SUM(CASE WHEN renter_id IS NOT NULL THEN 1 ELSE 0 END) as occupied')
    )
    .first();
  
  // Get renters in these houses
  const renters = await db('renter')
    .join('flat', 'renter.id', 'flat.renter_id')
    .whereIn('flat.house_id', houseIds)
    .select('renter.id', 'renter.status', 'renter.name', 'flat.house_id')
    .distinct();
  
  // Get assigned caretakers
  const caretakers = await db('caretakerassignment')
    .whereIn('houseId', houseIds)
    .andWhere('expiresAt', '>', new Date())
    .distinct('caretakerId')
    .count('* as count')
    .first();
  
  // Get upcoming payments (next 30 days)
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
  
  const upcomingPayments = await db('rent_payment as rp')
    .join('flat', 'rp.flat_id', 'flat.id')
    .join('house', 'rp.house_id', 'house.id')
    .join('renter', 'rp.renter_id', 'renter.id')
    .whereIn('rp.house_id', houseIds)
    .andWhere('rp.status', 'pending')
    .andWhere('rp.due_date', '<=', thirtyDaysFromNow)
    .andWhere('rp.due_date', '>=', new Date())
    .select(
      'rp.id',
      'rp.amount',
      'rp.due_date',
      'flat.number as flat_number',
      'flat.name as flat_name',
      'flat.id as flat_id',
      'house.name as house_name',
      'renter.name as renter_name',
      'renter.phone as renter_phone',
      db.raw('DATEDIFF(rp.due_date, CURDATE()) as days_left')
    )
    .orderBy('rp.due_date', 'asc')
    .limit(100);
  
  // Calculate rent collection progress for current and previous 5 months
  const rentCollectionProgress = {};
  
  // Get current date
  const currentDate = new Date();
  const currentMonth = currentDate.getMonth() + 1;
  const currentYear = currentDate.getFullYear();
  
  // For each house, get data for current month + previous 5 months
  for (const house of houses) {
    const houseMonthsData = [];
    
    // Get data for last 6 months (current + previous 5)
    for (let i = 0; i < 6; i++) {
      const targetDate = new Date(currentYear, currentMonth - 1 - i, 1);
      const targetMonth = targetDate.getMonth() + 1;
      const targetYear = targetDate.getFullYear();

      
      // Get total occupied flats in this house for the target month
    //   const totalFlats = await db('flat')
    //     .where('house_id', house.id)
    //     .andWhere('renter_id', '!=', null)
    //     .count('id as total')
    //     .first();

        const totalFlats = await db('flat')
        .where('house_id', house.id)
        .count('id as total')
        .first();
        
      
      // Get rent collected for this month in this house
      const rentCollected = await db('rent_payment')
        .where('house_id', house.id)
        .andWhere('status', 'paid')
        .andWhere(db.raw('MONTH(paid_date) = ?', [targetMonth]))
        .andWhere(db.raw('YEAR(paid_date) = ?', [targetYear]))
        .countDistinct('flat_id as collected')
        .first();
      
      houseMonthsData.push({
        month: targetMonth,
        year: targetYear,
        monthName: targetDate.toLocaleString('default', { month: 'long' }),
        total_flat: parseInt(totalFlats.total || 0),
        rent_collected: parseInt(rentCollected.collected || 0),
        percentage: parseInt(totalFlats.total || 0) > 0 
          ? Math.round((parseInt(rentCollected.collected || 0) / parseInt(totalFlats.total)) * 100)
          : 0,
        houseId: house.id,
        name: house.name
      });
    }
    
    // Reverse so oldest month is first, current month is last
    rentCollectionProgress[house.id] = houseMonthsData.reverse();
  }
  
  // For backward compatibility, also create the old format array for current month
  const currentMonthRentCollection = Object.values(rentCollectionProgress).map(houseData => {
    const current = houseData.find(data => 
      data.month === currentMonth && data.year === currentYear
    ) || houseData[houseData.length - 1];
    
    return {
      houseId: current.houseId,
      name: current.name,
      total_flat: current.total_flat,
      rent_collected: current.rent_collected,
      percentage: current.percentage
    };
  });
  
  // Get monthly rent collection for the last 12 months (chart data)
  const monthlyRentCollection = await db('rent_payment')
    .join('flat', 'rent_payment.flat_id', 'flat.id')
    .whereIn('flat.house_id', houseIds)
    .andWhere('rent_payment.status', 'paid')
    .andWhere('rent_payment.paid_date', '>=', startDate)
    .select(
      db.raw('DATE_FORMAT(rent_payment.paid_date, "%Y-%m") as month'),
      db.raw('SUM(rent_payment.paid_amount) as total_collected'),
      db.raw('COUNT(*) as payment_count')
    )
    .groupByRaw('DATE_FORMAT(rent_payment.paid_date, "%Y-%m")')
    .orderBy('month', 'asc');
  
  // Get rent collection by house for current month
  const rentCollectionByHouse = await db('rent_payment as rp')
    .join('house', 'rp.house_id', 'house.id')
    .whereIn('rp.house_id', houseIds)
    .andWhere('rp.status', 'paid')
    .andWhereRaw('MONTH(rp.paid_date) = ?', [currentMonth])
    .andWhereRaw('YEAR(rp.paid_date) = ?', [currentYear])
    .groupBy('rp.house_id', 'house.name')
    .select(
      'house.id',
      'house.name',
      db.raw('SUM(rp.paid_amount) as total_collected'),
      db.raw('COUNT(*) as payment_count')
    );
  
  // Get expense breakdown for current month
  const expenseBreakdown = await db('house_expense')
    .whereIn('house_id', houseIds)
    .andWhere('status', 'approved')
    .andWhereRaw('MONTH(expense_date) = ?', [currentMonth])
    .andWhereRaw('YEAR(expense_date) = ?', [currentYear])
    .groupBy('category')
    .select(
      'category',
      db.raw('SUM(amount) as total_amount'),
      db.raw('COUNT(*) as expense_count')
    );
  
  // Get recent transactions (last 10)
  const recentTransactions = await db.raw(`
    (SELECT 
      id,
      uuid,
      house_id,
      'rent_payment' as type,
      amount,
      paid_date as transaction_date,
      status,
      payment_method,
      NULL as category,
      created_at
    FROM rent_payment 
    WHERE house_id IN (?) AND status = 'paid'
    LIMIT 5)
    
    UNION ALL
    
    (SELECT 
      id,
      uuid,
      house_id,
      'advance_payment' as type,
      paid_amount as amount,
      payment_date as transaction_date,
      status,
      payment_method,
      'advance' as category,
      created_at
    FROM advance_payment 
    WHERE house_id IN (?)
    LIMIT 3)
    
    UNION ALL
    
    (SELECT 
      id,
      uuid,
      house_id,
      'expense' as type,
      amount,
      expense_date as transaction_date,
      status,
      payment_method,
      category,
      created_at
    FROM house_expense 
    WHERE house_id IN (?) AND status = 'approved'
    LIMIT 2)
    
    ORDER BY transaction_date DESC
    LIMIT 10
  `, [houseIds, houseIds, houseIds]);
  
  // Calculate net profit for current month
  const totalRentCollected = monthlyRentCollection
    .filter(item => item.month === `${currentYear}-${String(currentMonth).padStart(2, '0')}`)
    .reduce((sum, item) => sum + parseFloat(item.total_collected || 0), 0);
  
  const totalExpenses = expenseBreakdown
    .reduce((sum, item) => sum + parseFloat(item.total_amount || 0), 0);
  
  return {
    summary: {
      totalHouses: houses.length,
      activeHouses: houses.filter(h => h.active).length,
      inactiveHouses: houses.filter(h => !h.active).length,
      totalFlats: parseInt(flatStats?.total || 0),
      vacantFlats: parseInt(flatStats?.vacant || 0),
      occupiedFlats: parseInt(flatStats?.occupied || 0),
      totalRenters: renters.length,
      activeRenters: renters.filter(r => r.status === 'active').length,
      inactiveRenters: renters.filter(r => r.status !== 'active').length,
      assignedCaretakers: parseInt(caretakers?.count || 0),
      monthlyRentCollection: totalRentCollected,
      monthlyExpenses: totalExpenses,
      monthlyProfit: totalRentCollected - totalExpenses,
      occupancyRate: parseInt(flatStats?.total) > 0 
        ? Math.round((parseInt(flatStats?.occupied || 0) / parseInt(flatStats?.total)) * 100) 
        : 0
    },
    rentCollectionProgress, // New format: object with houseId as key
    currentMonthRentCollection, // Old format for backward compatibility
    upcomingPayments: upcomingPayments.map(payment => ({
      id: payment.id,
      amount: payment.amount,
      due_date: payment.due_date,
      days_left: payment.days_left,
      flat: {
        number: payment.flat_number,
        name: payment.flat_name,
        id: payment.flat_id
      },
      house: {
        name: payment.house_name
      },
      renter: {
        name: payment.renter_name,
        phone: payment.renter_phone
      }
    })),
    charts: {
      monthlyRentCollection: monthlyRentCollection.map(item => ({
        month: item.month,
        total_collected: parseFloat(item.total_collected || 0),
        payment_count: parseInt(item.payment_count || 0)
      })),
      rentCollectionByHouse: rentCollectionByHouse.map(item => ({
        house_id: item.id,
        house_name: item.name,
        total_collected: parseFloat(item.total_collected || 0),
        payment_count: parseInt(item.payment_count || 0)
      })),
      flatOccupancy: {
        vacant: parseInt(flatStats?.vacant || 0),
        occupied: parseInt(flatStats?.occupied || 0)
      },
      expenseBreakdown: expenseBreakdown.map(item => ({
        category: item.category,
        total_amount: parseFloat(item.total_amount || 0),
        expense_count: parseInt(item.expense_count || 0)
      }))
    },
    recentTransactions: recentTransactions[0] || [],
    houses: houses.map(house => ({
      id: house.id,
      name: house.name,
      address: house.address,
      active: house.active,
      flatCount: flats.filter(f => f.house_id === house.id).length,
      createdAt: house.createdAt
    })),
    currentMonth,
    currentYear,
    timestamp: new Date().toISOString()
  };
};

// Task router
parentPort.on('message', async ({ taskId, task, data }) => {
  try {
    let result;
    
    switch (task) {
      case 'houseOwnerDashboard':
        result = await computeHouseOwnerDashboard(data.houseOwnerId, data.months || 12);
        break;
        
      case 'houseOwnerMonthlyStats':
        result = await computeHouseOwnerMonthlyStats(data.houseOwnerId, data.month, data.year);
        break;
        
      case 'houseOwnerExpenseAnalysis':
        result = await computeHouseOwnerExpenseAnalysis(data.houseOwnerId, data.startDate, data.endDate);
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
      success: false
    });
  }
});

// Additional helper functions
const computeHouseOwnerMonthlyStats = async (houseOwnerId, month, year) => {
  const houseIds = await db('house')
    .where('ownerId', houseOwnerId)
    .pluck('id');
  
  if (houseIds.length === 0) {
    return {
      rentStats: { collected: 0, pending: 0, overdue: 0 },
      expenseStats: { total: 0, byCategory: {} },
      netProfit: 0,
      topPerformingHouse: null,
      paymentMethods: {}
    };
  }
  
  // Rent statistics for the month
  const rentStats = await db.raw(`
    SELECT 
      SUM(CASE WHEN status = 'paid' AND MONTH(paid_date) = ? AND YEAR(paid_date) = ? THEN paid_amount ELSE 0 END) as collected,
      SUM(CASE WHEN status = 'pending' AND MONTH(due_date) = ? AND YEAR(due_date) = ? THEN amount ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'overdue' AND MONTH(due_date) = ? AND YEAR(due_date) = ? THEN amount ELSE 0 END) as overdue
    FROM rent_payment
    WHERE house_id IN (?)
  `, [month, year, month, year, month, year, houseIds]);
  
  // Expense statistics
  const expenseStats = await db('house_expense')
    .whereIn('house_id', houseIds)
    .andWhere('status', 'approved')
    .andWhereRaw('MONTH(expense_date) = ?', [month])
    .andWhereRaw('YEAR(expense_date) = ?', [year])
    .select(
      'category',
      db.raw('SUM(amount) as total'),
      db.raw('COUNT(*) as count')
    )
    .groupBy('category');
  
  // Payment methods distribution
  const paymentMethods = await db('rent_payment')
    .whereIn('house_id', houseIds)
    .andWhere('status', 'paid')
    .andWhereRaw('MONTH(paid_date) = ?', [month])
    .andWhereRaw('YEAR(paid_date) = ?', [year])
    .select(
      'payment_method',
      db.raw('SUM(paid_amount) as total'),
      db.raw('COUNT(*) as count')
    )
    .groupBy('payment_method');
  
  // Top performing house (by rent collection)
  const topHouse = await db('rent_payment as rp')
    .join('house', 'rp.house_id', 'house.id')
    .whereIn('rp.house_id', houseIds)
    .andWhere('rp.status', 'paid')
    .andWhereRaw('MONTH(rp.paid_date) = ?', [month])
    .andWhereRaw('YEAR(rp.paid_date) = ?', [year])
    .groupBy('rp.house_id', 'house.name')
    .select(
      'house.id',
      'house.name',
      db.raw('SUM(rp.paid_amount) as total_collected'),
      db.raw('COUNT(*) as payment_count')
    )
    .orderBy('total_collected', 'desc')
    .first();
  
  const collected = parseFloat(rentStats[0][0]?.collected || 0);
  const expenses = expenseStats.reduce((sum, item) => sum + parseFloat(item.total || 0), 0);
  
  return {
    rentStats: {
      collected,
      pending: parseFloat(rentStats[0][0]?.pending || 0),
      overdue: parseFloat(rentStats[0][0]?.overdue || 0)
    },
    expenseStats: {
      total: expenses,
      byCategory: expenseStats.reduce((obj, item) => {
        obj[item.category] = {
          total: parseFloat(item.total || 0),
          count: parseInt(item.count || 0)
        };
        return obj;
      }, {})
    },
    netProfit: collected - expenses,
    topPerformingHouse: topHouse ? {
      id: topHouse.id,
      name: topHouse.name,
      total_collected: parseFloat(topHouse.total_collected || 0),
      payment_count: parseInt(topHouse.payment_count || 0)
    } : null,
    paymentMethods: paymentMethods.reduce((obj, item) => {
      obj[item.payment_method] = {
        total: parseFloat(item.total || 0),
        count: parseInt(item.count || 0)
      };
      return obj;
    }, {})
  };
};

const computeHouseOwnerExpenseAnalysis = async (houseOwnerId, startDate, endDate) => {
  const houseIds = await db('house')
    .where('ownerId', houseOwnerId)
    .pluck('id');
  
  if (houseIds.length === 0) {
    return {
      totalExpenses: 0,
      expenseTrend: [],
      topExpenseCategories: [],
      monthlyBreakdown: []
    };
  }
  
  // Total expenses in period
  const totalExpenses = await db('house_expense')
    .whereIn('house_id', houseIds)
    .andWhere('status', 'approved')
    .andWhere('expense_date', '>=', startDate)
    .andWhere('expense_date', '<=', endDate)
    .sum('amount as total')
    .first();
  
  // Expense trend over months
  const expenseTrend = await db('house_expense')
    .whereIn('house_id', houseIds)
    .andWhere('status', 'approved')
    .andWhere('expense_date', '>=', startDate)
    .andWhere('expense_date', '<=', endDate)
    .select(
      db.raw('DATE_FORMAT(expense_date, "%Y-%m") as month'),
      db.raw('SUM(amount) as total'),
      db.raw('COUNT(*) as count')
    )
    .groupByRaw('DATE_FORMAT(expense_date, "%Y-%m")')
    .orderBy('month', 'asc');
  
  // Top expense categories
  const topExpenseCategories = await db('house_expense')
    .whereIn('house_id', houseIds)
    .andWhere('status', 'approved')
    .andWhere('expense_date', '>=', startDate)
    .andWhere('expense_date', '<=', endDate)
    .groupBy('category')
    .select(
      'category',
      db.raw('SUM(amount) as total'),
      db.raw('COUNT(*) as count'),
      db.raw('AVG(amount) as average')
    )
    .orderBy('total', 'desc')
    .limit(5);
  
  // Monthly breakdown
  const monthlyBreakdown = await db.raw(`
    SELECT 
      DATE_FORMAT(expense_date, '%Y-%m') as month,
      category,
      SUM(amount) as total,
      COUNT(*) as count
    FROM house_expense
    WHERE house_id IN (?)
      AND status = 'approved'
      AND expense_date >= ?
      AND expense_date <= ?
    GROUP BY DATE_FORMAT(expense_date, '%Y-%m'), category
    ORDER BY month ASC, total DESC
  `, [houseIds, startDate, endDate]);
  
  return {
    totalExpenses: parseFloat(totalExpenses?.total || 0),
    expenseTrend: expenseTrend.map(item => ({
      month: item.month,
      total: parseFloat(item.total || 0),
      count: parseInt(item.count || 0)
    })),
    topExpenseCategories: topExpenseCategories.map(item => ({
      category: item.category,
      total: parseFloat(item.total || 0),
      count: parseInt(item.count || 0),
      average: parseFloat(item.average || 0)
    })),
    monthlyBreakdown: monthlyBreakdown[0]?.map(item => ({
      month: item.month,
      category: item.category,
      total: parseFloat(item.total || 0),
      count: parseInt(item.count || 0)
    })) || []
  };
};

// Cleanup
process.on('SIGTERM', async () => {
  await db.destroy();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await db.destroy();
  process.exit(0);
});

process.on('uncaughtException', async (error) => {
  console.error('Uncaught exception in house owner analytics worker:', error);
  await db.destroy();
  process.exit(1);
});