// controllers/houseOwnerAnalytics.controller.js
const db = require("../config/knex");
const houseOwnerAnalyticsService = require("../services/houseOwnerAnalytics.service");

class HouseOwnerAnalyticsController {

  constructor() {
    this.getHouseOwnerDashboard = this.getHouseOwnerDashboard.bind(this);
    this.getMonthlyStats = this.getMonthlyStats.bind(this);
    this.getExpenseAnalysis = this.getExpenseAnalysis.bind(this);
    this.refreshDashboard = this.refreshDashboard.bind(this);
    this.getAccessibleHouseOwners = this.getAccessibleHouseOwners.bind(this);
  }
  // Get house owner dashboard
  async getHouseOwnerDashboard(req, res) {
    try {
      let userId = req.user.id;
      const role = req.user.role.slug;

      if (role !== 'house_owner') {
        if(role === 'caretaker') {
          const accessibleOwners = await this.getAccessibleHouseOwners(userId);
          if (accessibleOwners.length === 0) {
            return res.status(403).json({
              success: false,
              error: 'No accessible house owners found for this caretaker'
            });
          }
        
          userId = accessibleOwners[0]; // Assuming first accessible owner for dashboard
        }
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

  async getAccessibleHouseOwners(caretakerId) {
        try {
            const owners = await db('caretakerassignment as ca')
                .join('house as h', 'ca.houseId', 'h.id')
                .where('ca.caretakerId', caretakerId)
                .andWhere(function() {
                    this.where('ca.expiresAt', '>', new Date())
                        .orWhereNull('ca.expiresAt');
                })
                .andWhere('h.active', true)
                .distinct('h.ownerId')
                .pluck('h.ownerId');
            
            return owners.map(id => parseInt(id));
        } catch (error) {
            console.error('Get accessible owners error:', error);
            return [];
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