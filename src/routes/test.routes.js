const express = require('express');
const router = express.Router();
const pushService = require('../services/pushNotification.service');
const authMiddleware = require('../middleware/auth.middleware');
const roleMiddleware = require('../middleware/role.middleware');

// Mock data for testing
const mockData = {
  notifications: [
    {
      id: 1,
      title: "Welcome to Bariporichalona",
      body: "Thank you for joining our platform! Get started by exploring your dashboard.",
      type: "welcome",
      data: {
        url: "/dashboard",
        action: "explore"
      }
    },
    {
      id: 2,
      title: "New House Added",
      body: "A new house has been registered in your account. Please review the details.",
      type: "house_added",
      data: {
        url: "/houses",
        houseId: 1,
        action: "review"
      }
    },
    {
      id: 3,
      title: "Rent Payment Due",
      body: "Rent for House #123 is due in 3 days. Amount: $500",
      type: "rent_due",
      data: {
        url: "/billing",
        houseId: 1,
        amount: 500,
        dueInDays: 3,
        action: "pay"
      }
    },
    {
      id: 4,
      title: "Maintenance Request",
      body: "New maintenance request submitted for Flat 3B. Please check details.",
      type: "maintenance",
      data: {
        url: "/maintenance",
        requestId: 1,
        flat: "3B",
        action: "review"
      }
    },
    {
      id: 5,
      title: "System Update",
      body: "Our system will undergo maintenance tomorrow from 2 AM to 4 AM.",
      type: "system",
      data: {
        url: "/announcements",
        maintenanceWindow: "2 AM - 4 AM",
        action: "view"
      }
    }
  ],
  houses: [
    {
      id: 1,
      name: "Green Valley Apartments",
      address: "123 Main Street, Dhaka"
    },
    {
      id: 2,
      name: "Skyline Residency",
      address: "456 Park Avenue, Chittagong"
    }
  ]
};

// Send test notification to current user (authenticated)
router.post('/send-to-me', authMiddleware, async (req, res) => {
  try {
    const { notificationId } = req.body;
    
    // Get a notification from mock data
    let notification;
    if (notificationId) {
      notification = mockData.notifications.find(n => n.id === parseInt(notificationId));
    }
    
    // Default to first notification if not specified
    if (!notification) {
      notification = mockData.notifications[0];
    }

    // Send notification to current user
    const result = await pushService.sendToUser(
      req.user.id,
      notification.title,
      notification.body,
      {
        type: notification.type,
        ...notification.data
      }
    );

    res.json({
      success: true,
      message: 'Test notification sent to you',
      notification,
      result
    });

  } catch (error) {
    console.error('Test notification error:', error);
    res.status(500).json({
      error: 'Failed to send test notification',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Send notification to web owner (admin only)
router.post('/send-to-web-owner', 
  authMiddleware, 
  roleMiddleware(['WEB_OWNER']),
  async (req, res) => {
    try {
      const { notificationId } = req.body;
      
      // Get a notification from mock data
      let notification;
      if (notificationId) {
        notification = mockData.notifications.find(n => n.id === parseInt(notificationId));
      }
      
      // Default to first notification if not specified
      if (!notification) {
        notification = mockData.notifications[0];
      }

      // Find WEB_OWNER users
      const webOwners = await req.prisma.user.findMany({
        where: {
          role: {
            slug: 'WEB_OWNER'
          },
          status: 'active'
        },
        select: {
          id: true,
          name: true,
          email: true
        }
      });

      if (webOwners.length === 0) {
        return res.status(404).json({
          error: 'No WEB_OWNER users found'
        });
      }

      const results = [];
      
      // Send to all WEB_OWNER users
      for (const owner of webOwners) {
        try {
          const result = await pushService.sendToUser(
            owner.id,
            notification.title,
            notification.body,
            {
              type: notification.type,
              ...notification.data,
              recipient: owner.email
            }
          );
          
          results.push({
            userId: owner.id,
            name: owner.name,
            email: owner.email,
            success: true,
            result
          });
        } catch (error) {
          results.push({
            userId: owner.id,
            name: owner.name,
            email: owner.email,
            success: false,
            error: error.message
          });
        }
      }

      res.json({
        success: true,
        message: `Notifications sent to ${webOwners.length} WEB_OWNER users`,
        notification,
        results,
        summary: {
          total: webOwners.length,
          successful: results.filter(r => r.success).length,
          failed: results.filter(r => !r.success).length
        }
      });

    } catch (error) {
      console.error('Send to web owner error:', error);
      res.status(500).json({
        error: 'Failed to send notifications to web owners',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

// Send notification to specific role
router.post('/send-to-role', 
  authMiddleware, 
  roleMiddleware(['WEB_OWNER', 'STAFF']),
  async (req, res) => {
    try {
      const { roleSlug, notificationId } = req.body;
      
      if (!roleSlug) {
        return res.status(400).json({
          error: 'roleSlug is required'
        });
      }

      // Get a notification from mock data
      let notification;
      if (notificationId) {
        notification = mockData.notifications.find(n => n.id === parseInt(notificationId));
      }
      
      // Default to first notification if not specified
      if (!notification) {
        notification = mockData.notifications[0];
      }

      const result = await pushService.sendToRole(
        roleSlug,
        notification.title,
        notification.body,
        {
          type: notification.type,
          ...notification.data,
          targetRole: roleSlug
        }
      );

      res.json({
        success: true,
        message: `Notification sent to role: ${roleSlug}`,
        notification,
        result
      });

    } catch (error) {
      console.error('Send to role error:', error);
      res.status(500).json({
        error: 'Failed to send notification to role',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

// Send notification to house stakeholders
router.post('/send-to-house', 
  authMiddleware, 
  roleMiddleware(['WEB_OWNER', 'STAFF', 'HOUSE_OWNER']),
  async (req, res) => {
    try {
      const { houseId, notificationId } = req.body;
      
      if (!houseId) {
        return res.status(400).json({
          error: 'houseId is required'
        });
      }

      // Get a notification from mock data
      let notification;
      if (notificationId) {
        notification = mockData.notifications.find(n => n.id === parseInt(notificationId));
      }
      
      // Default to a house-related notification
      if (!notification) {
        notification = mockData.notifications[2]; // Rent due notification
      }

      const result = await pushService.sendToHouseStakeholders(
        parseInt(houseId),
        notification.title,
        notification.body,
        {
          type: notification.type,
          ...notification.data,
          houseId: parseInt(houseId)
        }
      );

      res.json({
        success: true,
        message: `Notification sent to house ${houseId} stakeholders`,
        notification,
        result
      });

    } catch (error) {
      console.error('Send to house error:', error);
      res.status(500).json({
        error: 'Failed to send notification to house',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

// Bulk send all test notifications to current user
router.post('/send-all-to-me', authMiddleware, async (req, res) => {
  try {
    const results = [];
    
    // Send all mock notifications
    for (const notification of mockData.notifications) {
      try {
        const result = await pushService.sendToUser(
          req.user.id,
          notification.title,
          notification.body,
          {
            type: notification.type,
            ...notification.data
          }
        );
        
        results.push({
          notificationId: notification.id,
          title: notification.title,
          success: true,
          result
        });
        
        // Wait 1 second between notifications
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        results.push({
          notificationId: notification.id,
          title: notification.title,
          success: false,
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      message: 'All test notifications sent',
      results,
      summary: {
        total: mockData.notifications.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length
      }
    });

  } catch (error) {
    console.error('Send all error:', error);
    res.status(500).json({
      error: 'Failed to send all notifications',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get available test notifications
router.get('/test-notifications', authMiddleware, (req, res) => {
  res.json({
    success: true,
    notifications: mockData.notifications,
    houses: mockData.houses,
    usage: {
      send_to_me: 'POST /api/test/send-to-me with { notificationId: 1 }',
      send_to_web_owner: 'POST /api/test/send-to-web-owner (WEB_OWNER role required)',
      send_to_role: 'POST /api/test/send-to-role with { roleSlug: "HOUSE_OWNER", notificationId: 1 }',
      send_to_house: 'POST /api/test/send-to-house with { houseId: 1, notificationId: 1 }',
      send_all_to_me: 'POST /api/test/send-all-to-me'
    }
  });
});

module.exports = router;