const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth.middleware');
const db = require('../config/knex');
const { serializeBigInt } = require('../utils/serializer');

// Get user notifications with pagination
router.get('/', authMiddleware, async (req, res) => {
    try {
        const { 
            page = 1, 
            limit = 20, 
            unread = false,
            type,
            startDate,
            endDate 
        } = req.query;

        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const offset = (pageNum - 1) * limitNum;

        // Build query
        let query = db('notification')
            .where('userId', req.user.id);

        if (unread === 'true') {
            query = query.where('read', false);
        }

        if (type) {
            query = query.where('type', type);
        }

        if (startDate) {
            query = query.where('createdAt', '>=', new Date(startDate));
        }

        if (endDate) {
            query = query.where('createdAt', '<=', new Date(endDate));
        }

        // Get notifications with user details
        const notifications = await query
            .leftJoin('user', 'notification.userId', 'user.id')
            .select(
                'notification.*',
                'user.id as user_id',
                'user.name as user_name',
                'user.email as user_email',
                'user.avatarUrl as user_avatarUrl'
            )
            .orderBy('notification.createdAt', 'desc')
            .limit(limitNum)
            .offset(offset);

        // Get counts
        const [totalResult] = await db('notification')
            .where('userId', req.user.id)
            .count('* as total');

        const [unreadResult] = await db('notification')
            .where({
                userId: req.user.id,
                read: false
            })
            .count('* as count');

        const total = parseInt(totalResult.total);
        const unreadCount = parseInt(unreadResult.count);

        // Format response
        const formattedNotifications = notifications.map(notification => ({
            id: notification.id,
            userId: notification.userId,
            type: notification.type,
            title: notification.title,
            message: notification.message,
            data: notification.data ? JSON.parse(notification.data) : null,
            read: Boolean(notification.read),
            readAt: notification.readAt,
            createdAt: notification.createdAt,
            user: notification.user_id ? {
                id: notification.user_id,
                name: notification.user_name,
                email: notification.user_email,
                avatarUrl: notification.user_avatarUrl
            } : null
        }));

        res.json({
            success: true,
            notifications: serializeBigInt(formattedNotifications),
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.ceil(total / limitNum),
                hasNextPage: pageNum * limitNum < total,
                hasPrevPage: pageNum > 1
            },
            counts: {
                total,
                unread: unreadCount
            }
        });

    } catch (error) {
        console.error('Get notifications error:', error);
        res.status(500).json({
            error: 'Failed to fetch notifications'
        });
    }
});

// Get notification by ID
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const notificationId = req.params.id;

        let notification = await db('notification as n')
            .where({
                'n.id': notificationId,
                'n.userId': req.user.id
            })
            .leftJoin('user as u', 'n.userId', 'u.id')
            .select(
                'n.*',
                'u.id as user_id',
                'u.name as user_name',
                'u.email as user_email',
                'u.avatarUrl as user_avatarUrl'
            )
            .first();

        if (!notification) {
            return res.status(404).json({
                error: 'Notification not found'
            });
        }

        // Mark as read when fetched individually
        if (!notification.read) {
            await db('notification')
                .where('id', notificationId)
                .update({
                    read: true,
                    readAt: new Date()
                });
            
            notification.read = true;
            notification.readAt = new Date();
        }

        const formattedNotification = {
            id: notification.id,
            userId: notification.userId,
            type: notification.type,
            title: notification.title,
            message: notification.message,
            data: notification.data ? JSON.parse(notification.data) : null,
            read: Boolean(notification.read),
            readAt: notification.readAt,
            createdAt: notification.createdAt,
            user: notification.user_id ? {
                id: notification.user_id,
                name: notification.user_name,
                email: notification.user_email,
                avatarUrl: notification.user_avatarUrl
            } : null
        };

        res.json({
            success: true,
            notification: serializeBigInt(formattedNotification)
        });

    } catch (error) {
        console.error('Get notification error:', error);
        res.status(500).json({
            error: 'Failed to fetch notification'
        });
    }
});

// Mark notification as read
router.post('/:id/read', authMiddleware, async (req, res) => {
    try {
        const notificationId = req.params.id;

        const [updatedCount] = await db('notification')
            .where({
                id: notificationId,
                userId: req.user.id
            })
            .update({
                read: true,
                readAt: new Date()
            });

        if (updatedCount === 0) {
            return res.status(404).json({
                error: 'Notification not found'
            });
        }

        const notification = await db('notification')
            .where('id', notificationId)
            .first();

        res.json({
            success: true,
            message: 'Notification marked as read',
            notification: serializeBigInt(notification)
        });

    } catch (error) {
        console.error('Mark as read error:', error);
        res.status(500).json({
            error: 'Failed to mark notification as read'
        });
    }
});

// Mark all notifications as read
router.post('/read-all', authMiddleware, async (req, res) => {
    try {
        const result = await db('notification')
            .where({
                userId: req.user.id,
                read: false
            })
            .update({
                read: true,
                readAt: new Date()
            });

        res.json({
            success: true,
            message: 'All notifications marked as read',
            count: result
        });

    } catch (error) {
        console.error('Mark all as read error:', error);
        res.status(500).json({
            error: 'Failed to mark all notifications as read'
        });
    }
});

// Delete notification
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const notificationId = req.params.id;

        const [deletedCount] = await db('notification')
            .where({
                id: notificationId,
                userId: req.user.id
            })
            .del();

        if (deletedCount === 0) {
            return res.status(404).json({
                error: 'Notification not found'
            });
        }

        res.json({
            success: true,
            message: 'Notification deleted successfully'
        });

    } catch (error) {
        console.error('Delete notification error:', error);
        res.status(500).json({
            error: 'Failed to delete notification'
        });
    }
});

// Delete all read notifications
router.delete('/read/all', authMiddleware, async (req, res) => {
    try {
        const result = await db('notification')
            .where({
                userId: req.user.id,
                read: true
            })
            .del();

        res.json({
            success: true,
            message: 'All read notifications deleted',
            count: result
        });

    } catch (error) {
        console.error('Delete all read error:', error);
        res.status(500).json({
            error: 'Failed to delete read notifications'
        });
    }
});

// Get notification statistics
router.get('/stats/summary', authMiddleware, async (req, res) => {
    try {
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        const userId = req.user.id;

        // Get all counts in parallel
        const [total, unread, today, thisWeek, thisMonth, byType, last7Days] = await Promise.all([
            // Total notifications
            db('notification')
                .where('userId', userId)
                .count('* as total')
                .then(result => parseInt(result[0].total)),
            
            // Unread notifications
            db('notification')
                .where({
                    userId: userId,
                    read: false
                })
                .count('* as count')
                .then(result => parseInt(result[0].count)),
            
            // Today's notifications
            db('notification')
                .where('userId', userId)
                .where('createdAt', '>=', startOfDay)
                .count('* as count')
                .then(result => parseInt(result[0].count)),
            
            // This week's notifications
            db('notification')
                .where('userId', userId)
                .where('createdAt', '>=', startOfWeek)
                .count('* as count')
                .then(result => parseInt(result[0].count)),
            
            // This month's notifications
            db('notification')
                .where('userId', userId)
                .where('createdAt', '>=', startOfMonth)
                .count('* as count')
                .then(result => parseInt(result[0].count)),
            
            // Count by type
            db('notification')
                .where('userId', userId)
                .select('type')
                .count('* as count')
                .groupBy('type'),
            
            // Last 7 days activity
            (async () => {
                const days = [];
                for (let i = 6; i >= 0; i--) {
                    const date = new Date();
                    date.setDate(date.getDate() - i);
                    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
                    const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);

                    const [result] = await db('notification')
                        .where('userId', userId)
                        .where('createdAt', '>=', start)
                        .where('createdAt', '<', end)
                        .count('* as count');

                    days.push({
                        date: date.toISOString().split('T')[0],
                        count: parseInt(result.count)
                    });
                }
                return days;
            })()
        ]);

        res.json({
            success: true,
            stats: {
                total,
                unread,
                today,
                thisWeek,
                thisMonth,
                byType: byType.map(item => ({
                    type: item.type,
                    count: parseInt(item.count)
                })),
                last7Days
            }
        });

    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({
            error: 'Failed to fetch notification statistics'
        });
    }
});

// Mark multiple notifications as read
router.post('/batch/read', authMiddleware, async (req, res) => {
    try {
        const { notificationIds } = req.body;

        if (!notificationIds || !Array.isArray(notificationIds)) {
            return res.status(400).json({
                error: 'notificationIds array is required'
            });
        }

        const result = await db('notification')
            .whereIn('id', notificationIds)
            .where('userId', req.user.id)
            .update({
                read: true,
                readAt: new Date()
            });

        res.json({
            success: true,
            message: 'Notifications marked as read',
            count: result
        });

    } catch (error) {
        console.error('Batch read error:', error);
        res.status(500).json({
            error: 'Failed to mark notifications as read'
        });
    }
});

// Toggle notification read status
router.post('/:id/toggle-read', authMiddleware, async (req, res) => {
    try {
        const notificationId = req.params.id;

        const notification = await db('notification')
            .where({
                id: notificationId,
                userId: req.user.id
            })
            .first();

        if (!notification) {
            return res.status(404).json({
                error: 'Notification not found'
            });
        }

        const newReadStatus = !notification.read;

        await db('notification')
            .where('id', notificationId)
            .update({
                read: newReadStatus,
                readAt: newReadStatus ? new Date() : null
            });

        const updatedNotification = await db('notification')
            .where('id', notificationId)
            .first();

        res.json({
            success: true,
            message: `Notification marked as ${newReadStatus ? 'read' : 'unread'}`,
            notification: serializeBigInt(updatedNotification)
        });

    } catch (error) {
        console.error('Toggle read error:', error);
        res.status(500).json({
            error: 'Failed to toggle notification read status'
        });
    }
});

module.exports = router;