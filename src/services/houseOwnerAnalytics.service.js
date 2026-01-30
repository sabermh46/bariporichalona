// src/services/houseOwnerAnalytics.service.js
const { createHouseOwnerWorkerPool } = require('../utils/houseOwnerWorkerPool');
const db = require('../config/knex');

class HouseOwnerAnalyticsService {
  constructor() {
    this.workerPool = createHouseOwnerWorkerPool();
    this.cache = new Map();
    this.CACHE_TTL = 2 * 60 * 1000; // 2 minutes cache for real-time data
  }

  // Get comprehensive dashboard data for house owner
  async getHouseOwnerDashboard(userId) {
    const cacheKey = `houseOwnerDashboard_${userId}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp < this.CACHE_TTL)) {
      return cached.data;
    }

    try {
      // const dashboardData = await this.getHouseOwnerDashboardFallback(userId);
      const dashboardData = await this.workerPool.execute('houseOwnerDashboard', {
        houseOwnerId: userId,
        months: 12
      });

      // console.log(dashboardData);
      
      // Cache the result
      this.cache.set(cacheKey, {
        data: dashboardData,
        timestamp: Date.now()
      });

      return dashboardData;
    } catch (error) {
      console.error('Error getting house owner dashboard:', error);
      return await this.getHouseOwnerDashboardFallback(userId);
    }
  }

  // Fallback method if worker fails
  async getHouseOwnerDashboardFallback(userId) {
    // Simple fallback with basic queries
    const houses = await db('house')
      .where('ownerId', userId)
      .select('id', 'name', 'active');
    
    const houseIds = houses.map(h => h.id);
    
    // Basic stats
    const [totalFlats, occupiedFlats] = await Promise.all([
      db('flat').whereIn('house_id', houseIds).count('* as count').first(),
      db('flat').whereIn('house_id', houseIds).whereNotNull('renter_id').count('* as count').first()
    ]);
    
    const totalRenters = await db('renter')
      .join('flat', 'renter.id', 'flat.renter_id')
      .whereIn('flat.house_id', houseIds)
      .count('* as count')
      .first();

    //get cartetaker count for this house owner

    const assignedCaretakers = await db('caretakerassignment as ca')
      .whereIn('ca.houseId', houseIds)
      .countDistinct('ca.caretakerId as count')
      .first();
      
    
    return {
      summary: {
        totalHouses: houses.length,
        activeHouses: houses.filter(h => h.active).length,
        inactiveHouses: houses.filter(h => !h.active).length,
        totalFlats: parseInt(totalFlats?.count || 0),
        vacantFlats: parseInt(totalFlats?.count || 0) - parseInt(occupiedFlats?.count || 0),
        occupiedFlats: parseInt(occupiedFlats?.count || 0),
        totalRenters: parseInt(totalRenters?.count || 0),
        activeRenters: parseInt(totalRenters?.count || 0),
        assignedCaretakers: parseInt(assignedCaretakers?.count || 0)
      },
      rentCollectionProgress: [],
      upcomingPayments: [],
      charts: {
        monthlyRentCollection: [],
        rentCollectionByHouse: [],
        flatOccupancy: { vacant: 0, occupied: 0 },
        expenseBreakdown: []
      },
      recentTransactions: [],
      houses,
      timestamp: new Date().toISOString()
    };
  }

  // Get monthly statistics for a specific month
  async getHouseOwnerMonthlyStats(userId, month, year) {
    const cacheKey = `houseOwnerMonthlyStats_${userId}_${year}_${month}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp < this.CACHE_TTL)) {
      return cached.data;
    }

    try {
      const monthlyStats = await this.workerPool.execute('houseOwnerMonthlyStats', {
        houseOwnerId: userId,
        month,
        year
      });

      this.cache.set(cacheKey, {
        data: monthlyStats,
        timestamp: Date.now()
      });

      return monthlyStats;
    } catch (error) {
      console.error('Error getting monthly stats:', error);
      throw error;
    }
  }

  // Get expense analysis for a period
  async getHouseOwnerExpenseAnalysis(userId, startDate, endDate) {
    const cacheKey = `houseOwnerExpenseAnalysis_${userId}_${startDate}_${endDate}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp < this.CACHE_TTL)) {
      return cached.data;
    }

    try {
      const expenseAnalysis = await this.workerPool.execute('houseOwnerExpenseAnalysis', {
        houseOwnerId: userId,
        startDate,
        endDate
      });

      this.cache.set(cacheKey, {
        data: expenseAnalysis,
        timestamp: Date.now()
      });

      return expenseAnalysis;
    } catch (error) {
      console.error('Error getting expense analysis:', error);
      throw error;
    }
  }

  // Clear cache for specific house owner
  clearHouseOwnerCache(userId) {
    const keys = Array.from(this.cache.keys()).filter(key => key.includes(`_${userId}`));
    keys.forEach(key => this.cache.delete(key));
  }

  // Clear all cache
  clearAllCache() {
    this.cache.clear();
  }

  // Get worker pool stats
  getWorkerStats() {
    return this.workerPool ? this.workerPool.getStats() : { error: 'Worker pool not initialized' };
  }

  // Graceful shutdown
  async shutdown() {
    if (this.workerPool) {
      await this.workerPool.terminate();
    }
  }
}

// Singleton instance
const houseOwnerAnalyticsService = new HouseOwnerAnalyticsService();

// Cleanup on process exit
process.on('SIGTERM', async () => {
  await houseOwnerAnalyticsService.shutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await houseOwnerAnalyticsService.shutdown();
  process.exit(0);
});

module.exports = houseOwnerAnalyticsService;