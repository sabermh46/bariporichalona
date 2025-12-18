// workers/analytics.worker.js
const { parentPort } = require('worker_threads');
const prisma = require('../../config/prisma');

// Heavy computation functions
const computeUserGrowth = async (months = 12) => {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - months);
  
  const users = await prisma.user.groupBy({
    by: ['createdAt'],
    where: {
      createdAt: { gte: startDate }
    },
    _count: true
  });
  
  // Group by month
  const monthlyData = {};
  users.forEach(user => {
    const month = user.createdAt.toISOString().slice(0, 7);
    monthlyData[month] = (monthlyData[month] || 0) + user._count;
  });
  
  // Fill missing months
  const result = [];
  for (let i = months - 1; i >= 0; i--) {
    const date = new Date();
    date.setMonth(date.getMonth() - i);
    const monthKey = date.toISOString().slice(0, 7);
    result.push({
      month: monthKey,
      count: monthlyData[monthKey] || 0
    });
  }
  
  return result;
};

const computeHouseStatistics = async () => {
  const [
    totalHouses,
    activeHouses,
    housesWithFlats,
    housesWithCaretakers,
    recentHouses
  ] = await Promise.all([
    prisma.house.count(),
    prisma.house.count({ where: { active: true } }),
    prisma.house.findMany({
      where: {
        flats: { some: {} }
      },
      select: { id: true }
    }),
    prisma.house.findMany({
      where: {
        caretakers: { some: {} }
      },
      select: { id: true }
    }),
    prisma.house.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        owner: {
          select: {
            name: true,
            email: true
          }
        },
        _count: {
          select: {
            flats: true,
            caretakers: true
          }
        }
      }
    })
  ]);
  
  return {
    totalHouses,
    activeHouses,
    inactiveHouses: totalHouses - activeHouses,
    housesWithFlats: housesWithFlats.length,
    housesWithCaretakers: housesWithCaretakers.length,
    recentHouses
  };
};

const computeFinancialMetrics = async () => {
  // This would connect to payment/payment records
  // For now, return mock/stub data
  return {
    totalRevenue: 0,
    pendingPayments: 0,
    collectedThisMonth: 0,
    outstandingBalance: 0
  };
};

const computeRoleDistribution = async () => {
  const roles = await prisma.role.findMany({
    include: {
      _count: {
        select: { users: true }
      }
    }
  });
  
  return roles.map(role => ({
    role: role.name,
    count: role._count.users,
    slug: role.slug
  }));
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
        const [userGrowth, houseStats, roleDistribution] = await Promise.all([
          computeUserGrowth(),
          computeHouseStatistics(),
          computeRoleDistribution()
        ]);
        result = { userGrowth, houseStats, roleDistribution };
        break;
        
      default:
        throw new Error(`Unknown task: ${task}`);
    }
    
    parentPort.postMessage({ taskId, data: result });
  } catch (error) {
    parentPort.postMessage({ 
      taskId, 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});