const express = require('express');
const router = express.Router();
const pushService = require('../services/pushNotification.service');
const authMiddleware = require('../middleware/auth.middleware');
const roleMiddleware = require('../middleware/role.middleware');
const { serializeBigInt } = require('../utils/serializer');
const prisma = require('../config/prisma');


router.post('/subscribe', authMiddleware, async (req, res) => {
    try {
        // Handle both formats: { subscription: {...} } or subscription directly
        let subscription = req.body;
        
        // If subscription is nested, extract it
        if (req.body && req.body.subscription) {
            console.log('Found nested subscription');
            subscription = req.body.subscription;
        } else if (req.body && req.body.endpoint) {
            console.log('Found direct subscription');
            subscription = req.body;
        } else {
            return res.status(400).json({
                error: "Invalid subscription format",
                received: req.body
            });
        }

        const userAgent = req.get('User-Agent');

        // Convert BigInt userId to string for logging
        const userId = req.user.id.toString ? req.user.id.toString() : String(req.user.id);
        
        console.log('Processing subscription for user:', {
            userId,
            endpoint: subscription.endpoint,
            hasKeys: !!subscription.keys,
            p256dh: subscription.keys?.p256dh?.substring(0, 20) + '...',
            auth: subscription.keys?.auth?.substring(0, 10) + '...',
            userAgent: userAgent ? userAgent.substring(0, 50) + '...' : 'No user agent'
        });

        if (!subscription || !subscription.endpoint || !subscription.keys) {
            return res.status(400).json({
                error: "Invalid subscription object",
                missing: {
                    endpoint: !subscription?.endpoint,
                    keys: !subscription?.keys,
                    p256dh: !subscription?.keys?.p256dh,
                    auth: !subscription?.keys?.auth
                }
            });
        }

        // Convert userId to number for the service if needed
        const userIdNumber = Number(req.user.id);
        
        const savedSubscription = await pushService.saveSubscription(
            userIdNumber,
            subscription,
            userAgent
        );

        // Convert BigInt IDs to string for response
        const responseData = {
            success: true,
            message: "Subscription added successfully.",
            subscription: {
                id: savedSubscription.id.toString(),
                clientType: savedSubscription.clientType,
                createdAt: savedSubscription.createdAt
            }
        };

        res.status(201).json(responseData);

    } catch (error) {
        console.error("Subscribe Error:", error);
        
        // Handle BigInt in error if needed
        const errorResponse = {
            error: "Failed to save subscription",
            details: process.env.NODE_ENV === 'development' ? error.message : undefined,
            code: error.code
        };
        
        res.status(500).json(errorResponse);
    }
});


// Unsubscribe from push notifications
router.post('/unsubscribe', authMiddleware, async (req, res) => {
    try {
        const { endpoint } = req.body;
        
        if (!endpoint) {
            return res.status(400).json({
                error: 'Endpoint is required'
            });
        }

        console.log('Unsubscribing endpoint:', {
            endpoint: endpoint.substring(0, 50) + '...',
            userId: req.user.id.toString()
        });

        // Check if subscription exists and belongs to this user
        const subscription = await prisma.pushSubscription.findUnique({
            where: { endpoint }
        });

        if (!subscription) {
            return res.status(404).json({
                error: 'Subscription not found'
            });
        }

        // Verify ownership (optional but recommended for security)
        if (subscription.userId !== req.user.id) {
            return res.status(403).json({
                error: 'You do not have permission to unsubscribe this subscription'
            });
        }

        // Delete the subscription
        await prisma.pushSubscription.delete({
            where: { endpoint }
        });

        console.log('Subscription deleted successfully for user:', req.user.id.toString());

        res.json({
            success: true,
            message: 'Unsubscribed successfully'
        });

    } catch (error) {
        console.error('Unsubscribe error:', error);
        
        const errorResponse = {
            error: 'Failed to unsubscribe',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        };
        
        res.status(500).json(errorResponse);
    }
});

// Get user's subscriptions
router.get('/subscriptions', authMiddleware, async (req, res) => {
  try {
    const subscriptions = await req.prisma.pushSubscription.findMany({
      where: { userId: req.user.id },
      select: {
        id: true,
        endpoint: true,
        clientType: true,
        createdAt: true,
        lastUsed: true
      },
      orderBy: { lastUsed: 'desc' }
    });

    res.json({
      success: true,
      subscriptions
    });

  } catch (error) {
    console.error('Get subscriptions error:', error);
    res.status(500).json({
      error: 'Failed to fetch subscriptions'
    });
  }
});

// Send test notification to current user
router.post('/test', authMiddleware, async (req, res) => {
    try {
        // Convert user ID to string
        const userIdStr = req.user.id.toString();
        
        const result = await pushService.sendToUser(
            Number(req.user.id), // Send as number
            'Test Notification',
            'This is a test notification from Bariporichalona',
            {
                type: 'test',
                url: '/dashboard',
                userId: userIdStr, // Pass as string, not BigInt
                timestamp: Date.now()
            }
        );

        res.json({
            success: true,
            message: 'Test notification sent',
            result
        });

    } catch (error) {
        console.error('Test notification error:', error);
        res.status(500).json({
            error: 'Failed to send test notification',
            details: error.message
        });
    }
});

// Admin endpoints for sending notifications
router.post('/send/user/:userId', 
  authMiddleware, 
  roleMiddleware(['WEB_OWNER', 'STAFF']),
  async (req, res) => {
    try {
      const { title, body, data } = req.body;
      const { userId } = req.params;

      if (!title || !body) {
        return res.status(400).json({
          error: 'Title and body are required'
        });
      }

      const result = await pushService.sendToUser(
        parseInt(userId),
        title,
        body,
        data || {}
      );

      res.json({
        success: true,
        message: 'Notification sent',
        result
      });

    } catch (error) {
      console.error('Send notification error:', error);
      res.status(500).json({
        error: 'Failed to send notification'
      });
    }
  }
);

router.post('/send/role/:roleSlug',
  authMiddleware,
  roleMiddleware(['WEB_OWNER', 'STAFF']),
  async (req, res) => {
    try {
      const { title, body, data } = req.body;
      const { roleSlug } = req.params;

      if (!title || !body) {
        return res.status(400).json({
          error: 'Title and body are required'
        });
      }

      const result = await pushService.sendToRole(
        roleSlug,
        title,
        body,
        data || {}
      );

      res.json({
        success: true,
        message: 'Notifications sent to role',
        result
      });

    } catch (error) {
      console.error('Send to role error:', error);
      res.status(500).json({
        error: 'Failed to send notifications'
      });
    }
  }
);

router.post('/send/house/:houseId',
  authMiddleware,
  roleMiddleware(['WEB_OWNER', 'STAFF', 'HOUSE_OWNER']),
  async (req, res) => {
    try {
      const { title, body, data } = req.body;
      const { houseId } = req.params;

      if (!title || !body) {
        return res.status(400).json({
          error: 'Title and body are required'
        });
      }

      const result = await pushService.sendToHouseStateholders(
        parseInt(houseId),
        title,
        body,
        data || {}
      );

      res.json({
        success: true,
        message: 'Notifications sent to house stakeholders',
        result
      });

    } catch (error) {
      console.error('Send to house error:', error);
      res.status(500).json({
        error: 'Failed to send notifications'
      });
    }
  }
);

// Get notification logs for user
router.get('/logs', authMiddleware, async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;

    const logs = await req.prisma.pushNotificationLog.findMany({
      where: { userId: req.user.id },
      include: {
        subscription: {
          select: {
            clientType: true
          }
        }
      },
      orderBy: { sentAt: 'desc' },
      take: parseInt(limit),
      skip: parseInt(offset)
    });

    const total = await req.prisma.pushNotificationLog.count({
      where: { userId: req.user.id }
    });

    res.json({
      success: true,
      logs,
      total,
      hasMore: total > parseInt(offset) + logs.length
    });

  } catch (error) {
    console.error('Get logs error:', error);
    res.status(500).json({
      error: 'Failed to fetch logs'
    });
  }
});

module.exports = router;