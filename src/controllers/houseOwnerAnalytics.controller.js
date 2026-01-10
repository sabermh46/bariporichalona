// controllers/houseOwnerAnalytics.controller.js
const houseOwnerAnalyticsService = require("../services/houseOwnerAnalytics.service");

class HouseOwnerAnalyticsController {
  // Get house owner dashboard
  async getHouseOwnerDashboard(req, res) {
    try {
      const userId = req.user.id;
      
      // Verify user is a house owner
      if (req.user.role.slug !== 'house_owner') {
        return res.status(403).json({
          success: false,
          error: 'Only house owners can access this dashboard'
        });
      }

      const data = await houseOwnerAnalyticsService.getHouseOwnerDashboard(userId);
      
      res.json({
        success: true,
        data,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('House owner dashboard error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch dashboard data'
      });
    }
  }

  // Get monthly statistics
  async getMonthlyStats(req, res) {
    try {
      const userId = req.user.id;
      const { month, year } = req.query;
      
      if (!month || !year) {
        return res.status(400).json({
          success: false,
          error: 'Month and year are required'
        });
      }

      const data = await houseOwnerAnalyticsService.getHouseOwnerMonthlyStats(
        userId, 
        parseInt(month), 
        parseInt(year)
      );
      
      res.json({
        success: true,
        data
      });
    } catch (error) {
      console.error('Monthly stats error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch monthly statistics'
      });
    }
  }

  // Get expense analysis
  async getExpenseAnalysis(req, res) {
    try {
      const userId = req.user.id;
      const { startDate, endDate } = req.query;
      
      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          error: 'Start date and end date are required'
        });
      }

      const data = await houseOwnerAnalyticsService.getHouseOwnerExpenseAnalysis(
        userId, 
        new Date(startDate), 
        new Date(endDate)
      );
      
      res.json({
        success: true,
        data
      });
    } catch (error) {
      console.error('Expense analysis error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch expense analysis'
      });
    }
  }

  // Refresh dashboard (clear cache)
  async refreshDashboard(req, res) {
    try {
      const userId = req.user.id;
      
      houseOwnerAnalyticsService.clearHouseOwnerCache(userId);
      
      res.json({
        success: true,
        message: 'Dashboard cache cleared successfully'
      });
    } catch (error) {
      console.error('Refresh dashboard error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to refresh dashboard'
      });
    }
  }
}

module.exports = new HouseOwnerAnalyticsController();