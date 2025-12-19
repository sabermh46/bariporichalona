// src/controllers/push.controller.js
const pushService = require('../services/pushNotification.service');
const db = require('../config/knex');

class PushController {
  // Subscribe to push notifications
  async subscribe(req, res) {
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
  }

  // Unsubscribe from push notifications
  async unsubscribe(req, res) {
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
      const subscription = await db('pushsubscription')
        .where({ endpoint })
        .first();

      if (!subscription) {
        return res.status(404).json({
          error: 'Subscription not found'
        });
      }

      // Verify ownership (optional but recommended for security)
      if (subscription.userId.toString() !== req.user.id.toString()) {
        return res.status(403).json({
          error: 'You do not have permission to unsubscribe this subscription'
        });
      }

      // Delete the subscription
      await db('pushsubscription')
        .where({ endpoint })
        .delete();

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
  }

  // Get user's subscriptions
  async getSubscriptions(req, res) {
    try {
      const subscriptions = await db('pushsubscription')
        .where({ userId: BigInt(req.user.id) })
        .select('id', 'endpoint', 'clientType', 'createdAt', 'lastUsed')
        .orderBy('lastUsed', 'desc');

      // Convert BigInt to strings
      const formattedSubscriptions = subscriptions.map(sub => ({
        ...sub,
        id: sub.id.toString(),
        userId: sub.userId.toString()
      }));

      res.json({
        success: true,
        subscriptions: formattedSubscriptions
      });

    } catch (error) {
      console.error('Get subscriptions error:', error);
      res.status(500).json({
        error: 'Failed to fetch subscriptions'
      });
    }
  }

  // Send test notification to current user
  async sendTest(req, res) {
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
  }

  // Send notification to specific user (admin)
  async sendToUser(req, res) {
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

  // Send notification to role (admin)
  async sendToRole(req, res) {
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

  // Send notification to house stakeholders
  async sendToHouse(req, res) {
    try {
      const { title, body, data } = req.body;
      const { houseId } = req.params;

      if (!title || !body) {
        return res.status(400).json({
          error: 'Title and body are required'
        });
      }

      const result = await pushService.sendToHouseStakeholders(
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

  // Get notification logs for user
  async getLogs(req, res) {
    try {
      const { limit = 50, offset = 0 } = req.query;

      const logs = await db('pushnotificationlog as pnl')
        .where('pnl.userId', BigInt(req.user.id))
        .leftJoin('pushsubscription as ps', 'pnl.subscriptionId', 'ps.id')
        .select(
          'pnl.*',
          'ps.clientType'
        )
        .orderBy('pnl.sentAt', 'desc')
        .limit(parseInt(limit))
        .offset(parseInt(offset));

      // Convert BigInt to strings and parse JSON data
      const formattedLogs = logs.map(log => {
        const formatted = {
          ...log,
          id: log.id.toString(),
          userId: log.userId.toString(),
          subscriptionId: log.subscriptionId ? log.subscriptionId.toString() : null
        };

        // Parse JSON data if it exists
        if (log.data && typeof log.data === 'string') {
          try {
            formatted.data = JSON.parse(log.data);
          } catch (e) {
            formatted.data = log.data;
          }
        }

        return formatted;
      });

      const total = await db('pushnotificationlog')
        .where({ userId: BigInt(req.user.id) })
        .count('* as count')
        .first()
        .then(r => parseInt(r.count));

      res.json({
        success: true,
        logs: formattedLogs,
        total,
        hasMore: total > parseInt(offset) + logs.length
      });

    } catch (error) {
      console.error('Get logs error:', error);
      res.status(500).json({
        error: 'Failed to fetch logs'
      });
    }
  }

  // Get user notification statistics
  async getStats(req, res) {
    try {
      const stats = await pushService.getNotificationStats(req.user.id);

      res.json({
        success: true,
        stats
      });
    } catch (error) {
      console.error('Get stats error:', error);
      res.status(500).json({
        error: 'Failed to fetch notification statistics'
      });
    }
  }

  // Get notification history for user (notifications table)
  async getNotifications(req, res) {
    try {
      const { limit = 20, offset = 0, unread = false } = req.query;

      let query = db('notification')
        .where({ userId: BigInt(req.user.id) })
        .orderBy('createdAt', 'desc');

      if (unread === 'true') {
        query = query.where({ read: false });
      }

      const notifications = await query
        .limit(parseInt(limit))
        .offset(parseInt(offset));

      // Parse metadata if it exists
      const formattedNotifications = notifications.map(notification => {
        const formatted = {
          ...notification,
          id: notification.id.toString(),
          userId: notification.userId.toString()
        };

        // Parse metadata if it exists
        if (notification.metadata && typeof notification.metadata === 'string') {
          try {
            formatted.metadata = JSON.parse(notification.metadata);
          } catch (e) {
            formatted.metadata = {};
          }
        }

        return formatted;
      });

      const total = await db('notification')
        .where({ userId: BigInt(req.user.id) })
        .count('* as count')
        .first()
        .then(r => parseInt(r.count));

      const unreadCount = await db('notification')
        .where({ userId: BigInt(req.user.id), read: false })
        .count('* as count')
        .first()
        .then(r => parseInt(r.count));

      res.json({
        success: true,
        notifications: formattedNotifications,
        total,
        unreadCount,
        hasMore: total > parseInt(offset) + notifications.length
      });

    } catch (error) {
      console.error('Get notifications error:', error);
      res.status(500).json({
        error: 'Failed to fetch notifications'
      });
    }
  }

  // Mark notification as read
  async markAsRead(req, res) {
    try {
      const { notificationId } = req.params;

      await db('notification')
        .where({ id: BigInt(notificationId), userId: BigInt(req.user.id) })
        .update({
          read: true,
          readAt: new Date(),
          updatedAt: new Date()
        });

      res.json({
        success: true,
        message: 'Notification marked as read'
      });
    } catch (error) {
      console.error('Mark as read error:', error);
      res.status(500).json({
        error: 'Failed to mark notification as read'
      });
    }
  }

  // Mark all notifications as read
  async markAllAsRead(req, res) {
    try {
      await db('notification')
        .where({ userId: BigInt(req.user.id), read: false })
        .update({
          read: true,
          readAt: new Date(),
          updatedAt: new Date()
        });

      res.json({
        success: true,
        message: 'All notifications marked as read'
      });
    } catch (error) {
      console.error('Mark all as read error:', error);
      res.status(500).json({
        error: 'Failed to mark notifications as read'
      });
    }
  }

  // Delete notification
  async deleteNotification(req, res) {
    try {
      const { notificationId } = req.params;

      await db('notification')
        .where({ id: BigInt(notificationId), userId: BigInt(req.user.id) })
        .delete();

      res.json({
        success: true,
        message: 'Notification deleted'
      });
    } catch (error) {
      console.error('Delete notification error:', error);
      res.status(500).json({
        error: 'Failed to delete notification'
      });
    }
  }

  // Clear all notifications
  async clearAllNotifications(req, res) {
    try {
      await db('notification')
        .where({ userId: BigInt(req.user.id) })
        .delete();

      res.json({
        success: true,
        message: 'All notifications cleared'
      });
    } catch (error) {
      console.error('Clear all notifications error:', error);
      res.status(500).json({
        error: 'Failed to clear notifications'
      });
    }
  }
}

module.exports = new PushController();