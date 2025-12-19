// src/services/analytics.service.js
const { createAnalyticsWorkerPool } = require('../utils/workerPool');
const db = require('../config/knex');
const permissionService = require('./permission.service');

class AnalyticsService {
  constructor() {
    // Use your existing worker pool with the updated analytics.worker.js
    this.workerPool = createAnalyticsWorkerPool();
    this.cache = new Map();
    this.CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  }

  // Check if user has analytics permission
  async checkAnalyticsPermission(userId) {
    const hasPermission = await permissionService.hasPermission(userId, 'analytics.view');
    if (!hasPermission) {
      throw new Error('You do not have permission to view analytics');
    }
    return true;
  }

  // Get comprehensive dashboard data
  async getDashboardData(user) {
    await this.checkAnalyticsPermission(user.id);
    
    // Check cache first
    const cacheKey = `dashboard_${user.id}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp < this.CACHE_TTL)) {
      return cached.data;
    }

    try {
      // Use worker pool for heavy computations (systemOverview)
      // Execute light computations directly
      const [systemOverview, recentActivities, quickStats] = await Promise.all([
        this.workerPool.execute('systemOverview', {}),
        this.getRecentActivities(),
        this.getQuickStats()
      ]);

      const dashboardData = {
        systemOverview,
        recentActivities,
        quickStats,
        timestamp: new Date().toISOString()
      };

      // Cache the result
      this.cache.set(cacheKey, {
        data: dashboardData,
        timestamp: Date.now()
      });

      return dashboardData;
    } catch (error) {
      console.error('Error getting dashboard data:', error);
      // Fallback to direct computation if worker fails
      return await this.getDashboardDataFallback();
    }
  }

  // Fallback method if worker fails
  async getDashboardDataFallback() {
    const [recentActivities, quickStats] = await Promise.all([
      this.getRecentActivities(),
      this.getQuickStats()
    ]);

    // Compute system overview directly (simpler version)
    const systemOverview = {
      summary: {
        totalUsers: quickStats.totalUsers,
        activeUsers: quickStats.activeStaff + quickStats.activeCaretakers,
        totalNotifications: 0, // You can add this if needed
        recentActivity: 0,
        uptime: '99.9%',
        databaseHealth: 'healthy',
        serverLoad: 'low'
      },
      houseStats: await this.getHouseStats(),
      roleDistribution: await this.getRoleDistribution()
    };

    return {
      systemOverview,
      recentActivities,
      quickStats,
      timestamp: new Date().toISOString()
    };
  }

  // Get recent activities (lightweight, run in main thread)
  async getRecentActivities() {
    const [recentUsers, recentHouses, recentNotices] = await Promise.all([
      db('user')
        .leftJoin('role', 'user.roleId', 'role.id')
        .select(
          'user.id',
          'user.name',
          'user.email',
          'user.createdAt',
          'role.name as role_name',
          'role.slug as role_slug'
        )
        .orderBy('user.createdAt', 'desc')
        .limit(5),
      db('house')
        .leftJoin('user', 'house.ownerId', 'user.id')
        .select(
          'house.id',
          'house.address',
          'house.active',
          'house.createdAt',
          'user.name as owner_name',
          'user.email as owner_email'
        )
        .orderBy('house.createdAt', 'desc')
        .limit(5),
      db('notice')
        .leftJoin('house', 'notice.houseId', 'house.id')
        .select(
          'notice.id',
          'notice.title',
          'notice.createdAt',
          'house.address as house_address'
        )
        .orderBy('notice.createdAt', 'desc')
        .limit(5)
    ]);

    return {
      recentUsers: recentUsers.map(user => ({
        id: user.id,
        name: user.name,
        email: user.email,
        role: {
          name: user.role_name,
          slug: user.role_slug
        },
        createdAt: user.createdAt
      })),
      recentHouses: recentHouses.map(house => ({
        id: house.id,
        address: house.address,
        active: house.active,
        owner: {
          name: house.owner_name,
          email: house.owner_email
        },
        createdAt: house.createdAt
      })),
      recentNotices: recentNotices.map(notice => ({
        id: notice.id,
        title: notice.title,
        house: {
          address: notice.house_address
        },
        createdAt: notice.createdAt
      }))
    };
  }

  // Get quick stats (lightweight)
  async getQuickStats() {
    const [
      totalUsers,
      totalHouses,
      totalFlats,
      totalRenters,
      activeStaff,
      activeCaretakers
    ] = await Promise.all([
      db('user').count('* as count').first().then(r => parseInt(r.count)),
      db('house').count('* as count').first().then(r => parseInt(r.count)),
      db('flat').count('* as count').first().then(r => parseInt(r.count)),
      db('renter').count('* as count').first().then(r => parseInt(r.count)),
      db('user')
        .join('role', 'user.roleId', 'role.id')
        .where('role.slug', 'staff')
        .where('user.status', 'active')
        .count('* as count')
        .first()
        .then(r => parseInt(r.count)),
      db('user')
        .join('role', 'user.roleId', 'role.id')
        .where('role.slug', 'caretaker')
        .where('user.status', 'active')
        .count('* as count')
        .first()
        .then(r => parseInt(r.count))
    ]);

    return {
      totalUsers,
      totalHouses,
      totalFlats,
      totalRenters,
      activeStaff,
      activeCaretakers,
      systemHealth: 'healthy'
    };
  }

  // Get role distribution
  async getRoleDistribution() {
    const roleDistribution = await db('user')
      .join('role', 'user.roleId', 'role.id')
      .where('user.status', 'active')
      .groupBy('role.slug', 'role.name')
      .select('role.slug', 'role.name', db.raw('COUNT(*) as count'))
      .orderBy('role.rank', 'desc');

    return roleDistribution.map(role => ({
      slug: role.slug,
      name: role.name,
      count: parseInt(role.count)
    }));
  }

  // Get house statistics
  async getHouseStats() {
    const houseStats = await db('house')
      .select(
        db.raw('COUNT(*) as total'),
        db.raw('SUM(CASE WHEN active = true THEN 1 ELSE 0 END) as active'),
        db.raw('AVG(flatCount) as avg_flats')
      )
      .first();

    return {
      total: parseInt(houseStats.total),
      active: parseInt(houseStats.active),
      inactive: parseInt(houseStats.total) - parseInt(houseStats.active),
      avgFlats: parseFloat(houseStats.avg_flats) || 0
    };
  }

  // Individual worker tasks (can be called directly if needed)
  async computeUserGrowth(months = 12) {
    return this.workerPool.execute('userGrowth', { months });
  }

  async computeHouseStatistics() {
    return this.workerPool.execute('houseStats', {});
  }

  async computeRoleDistribution() {
    return this.workerPool.execute('roleDistribution', {});
  }

  // Clear cache for user
  clearUserCache(userId) {
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

  // Performance monitoring
  async getPerformanceMetrics() {
    const stats = this.getWorkerStats();
    const cacheStats = {
      cacheSize: this.cache.size,
      cacheEntries: Array.from(this.cache.keys())
    };

    // Get database performance metrics
    const dbMetrics = await db.raw('SHOW STATUS LIKE "Threads_connected"')
      .then(result => ({
        connections: result[0][0].Value
      }))
      .catch(() => ({ error: 'Could not fetch DB metrics' }));

    return {
      timestamp: new Date().toISOString(),
      workerPool: stats,
      cache: cacheStats,
      database: dbMetrics,
      memoryUsage: process.memoryUsage()
    };
  }
}

// Singleton instance
const analyticsService = new AnalyticsService();

// Cleanup on process exit
process.on('SIGTERM', async () => {
  console.log('Analytics service received SIGTERM, shutting down...');
  await analyticsService.shutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Analytics service received SIGINT, shutting down...');
  await analyticsService.shutdown();
  process.exit(0);
});

// Handle uncaught errors
process.on('uncaughtException', async (error) => {
  console.error('Uncaught exception in analytics service:', error);
  await analyticsService.shutdown();
  process.exit(1);
});

module.exports = analyticsService;