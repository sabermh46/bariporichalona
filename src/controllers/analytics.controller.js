// controllers/analytics.controller.js
const analyticsService = require("../services/analytics.service");

class AnalyticsController {
  // Get comprehensive dashboard data
  async getDashboardData(req, res) {
    try {
      const data = await analyticsService.getDashboardData(req.user);
      
      res.json({
        success: true,
        data,
        timestamp: new Date().toISOString(),
        cached: false // Could be determined from service
      });
    } catch (error) {
      console.error('Dashboard data error:', error);
      res.status(error.message.includes('permission') ? 403 : 500).json({
        success: false,
        error: error.message
      });
    }
  }

  // Get worker statistics (admin only)
  async getWorkerStats(req, res) {
    try {
      // Only web owner can view worker stats
      if (req.user.role.slug !== 'web_owner') {
        return res.status(403).json({
          success: false,
          error: 'Only web owner can view worker statistics'
        });
      }

      const stats = analyticsService.getWorkerStats();
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      console.error('Worker stats error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch worker statistics'
      });
    }
  }

  // Clear analytics cache (admin only)
  async clearCache(req, res) {
    try {
      if (req.user.role.slug !== 'web_owner') {
        return res.status(403).json({
          success: false,
          error: 'Only web owner can clear analytics cache'
        });
      }

      const { userId } = req.body;
      
      if (userId) {
        analyticsService.clearUserCache(userId);
        res.json({
          success: true,
          message: `Cache cleared for user ${userId}`
        });
      } else {
        analyticsService.clearAllCache();
        res.json({
          success: true,
          message: 'All analytics cache cleared'
        });
      }
    } catch (error) {
      console.error('Clear cache error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to clear cache'
      });
    }
  }
}

module.exports = new AnalyticsController();