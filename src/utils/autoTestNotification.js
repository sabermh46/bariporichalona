// src/utils/autoTestNotification.js

const pushService = require('../services/pushNotification.service');

/**
 * Automatically send a welcome notification when WEB_OWNER logs in
 */
const sendAutoWelcomeNotification = async (userId, userRoleSlug) => {
  try {
    // Only send to WEB_OWNER on first login (you can track this in your login logic)
    if (userRoleSlug === 'WEB_OWNER') {
      const notification = {
        title: '🎉 Welcome Back, Admin!',
        body: 'You have successfully logged in as WEB_OWNER. Check your dashboard for system updates.',
        type: 'admin_welcome',
        data: {
          url: '/admin/dashboard',
          action: 'view_dashboard',
          loginTime: new Date().toISOString()
        }
      };

      const result = await pushService.sendToUser(
        userId,
        notification.title,
        notification.body,
        {
          type: notification.type,
          ...notification.data
        }
      );

      console.log('Auto welcome notification sent to WEB_OWNER:', result);
      return result;
    }
    
    return null;
  } catch (error) {
    console.error('Error sending auto welcome notification:', error);
    return null;
  }
};

/**
 * Send daily system status report to WEB_OWNER
 */
const sendDailySystemReport = async (userId) => {
  try {
    // Get system stats (mock data for now)
    const stats = {
      totalUsers: 150,
      activeHouses: 25,
      pendingRents: 8,
      maintenanceRequests: 3,
      newRegistrationsToday: 2
    };

    const notification = {
      title: '📊 Daily System Report',
      body: `System Status: ${stats.totalUsers} users, ${stats.activeHouses} houses, ${stats.pendingRents} pending rents, ${stats.maintenanceRequests} maintenance requests, ${stats.newRegistrationsToday} new registrations today.`,
      type: 'system_report',
      data: {
        url: '/admin/reports',
        action: 'view_report',
        stats,
        reportDate: new Date().toISOString().split('T')[0]
      }
    };

    const result = await pushService.sendToUser(
      userId,
      notification.title,
      notification.body,
      {
        type: notification.type,
        ...notification.data
      }
    );

    console.log('Daily system report sent:', result);
    return result;
  } catch (error) {
    console.error('Error sending daily system report:', error);
    return null;
  }
};

module.exports = {
  sendAutoWelcomeNotification,
  sendDailySystemReport
};