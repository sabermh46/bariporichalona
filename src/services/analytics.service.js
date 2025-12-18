// services/analytics.service.js
const { createAnalyticsWorkerPool } = require('../utils/workerPool');
const prisma = require('../config/prisma');
const permissionService = require('./permission.service');

class AnalyticsService {
  constructor() {
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

    // Use worker pool for heavy computations
    const [systemOverview, recentActivities, quickStats] = await Promise.all([
      this.workerPool.execute('systemOverview'),
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
  }

  // Get recent activities (lightweight, run in main thread)
  async getRecentActivities() {
    const [recentUsers, recentHouses, recentNotices] = await Promise.all([
      prisma.user.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          createdAt: true
        }
      }),
      prisma.house.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          address: true,
          active: true,
          owner: {
            select: {
              name: true,
              email: true
            }
          },
          createdAt: true
        }
      }),
      prisma.notice.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          title: true,
          house: {
            select: {
              address: true
            }
          },
          createdAt: true
        }
      })
    ]);

    return {
      recentUsers,
      recentHouses,
      recentNotices
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
      prisma.user.count(),
      prisma.house.count(),
      prisma.flat.count(),
      prisma.renter.count(),
      prisma.user.count({
        where: {
          role: { slug: 'staff' },
          status: 'active'
        }
      }),
      prisma.user.count({
        where: {
          role: { slug: 'caretaker' },
          status: 'active'
        }
      })
    ]);

    return {
      totalUsers,
      totalHouses,
      totalFlats,
      totalRenters,
      activeStaff,
      activeCaretakers,
      systemHealth: 'healthy' // Could be computed based on various metrics
    };
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
    return this.workerPool.getStats();
  }

  // Graceful shutdown
  async shutdown() {
    await this.workerPool.terminate();
  }
}

// Singleton instance
const analyticsService = new AnalyticsService();

// Cleanup on process exit
process.on('SIGTERM', () => analyticsService.shutdown());
process.on('SIGINT', () => analyticsService.shutdown());

module.exports = analyticsService;