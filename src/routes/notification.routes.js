const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth.middleware');
const prisma = require('../config/prisma');

// Helper to convert BigInt to String
const convertBigIntToString = (obj) => {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'bigint') return obj.toString();
    if (Array.isArray(obj)) return obj.map(convertBigIntToString);
    if (typeof obj === 'object' && obj.constructor === Object) {
        const newObj = {};
        for (const key in obj) {
            newObj[key] = convertBigIntToString(obj[key]);
        }
        return newObj;
    }
    return obj;
};

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
        const skip = (pageNum - 1) * limitNum;

        // Build where clause
        const where = {
            userId: req.user.id
        };

        if (unread === 'true') {
            where.read = false;
        }

        if (type) {
            where.type = type;
        }

        if (startDate || endDate) {
            where.createdAt = {};
            if (startDate) {
                where.createdAt.gte = new Date(startDate);
            }
            if (endDate) {
                where.createdAt.lte = new Date(endDate);
            }
        }

        // Get notifications
        const notifications = await prisma.notification.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip,
            take: limitNum,
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        avatarUrl: true
                    }
                }
            }
        });

        // Get total count for pagination
        const total = await prisma.notification.count({ where });
        const unreadCount = await prisma.notification.count({
            where: { ...where, read: false }
        });

        // Convert BigInt to String
        const serializedNotifications = notifications.map(notification => ({
            ...notification,
            id: notification.id.toString(),
            userId: notification.userId.toString(),
            user: notification.user ? {
                ...notification.user,
                id: notification.user.id.toString()
            } : null
        }));

        res.json({
            success: true,
            notifications: serializedNotifications,
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
        const notificationId = BigInt(req.params.id);

        const notification = await prisma.notification.findUnique({
            where: {
                id: notificationId,
                userId: req.user.id // Ensure user can only access their own notifications
            },
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        avatarUrl: true
                    }
                }
            }
        });

        if (!notification) {
            return res.status(404).json({
                error: 'Notification not found'
            });
        }

        // Mark as read when fetched individually
        if (!notification.read) {
            await prisma.notification.update({
                where: { id: notificationId },
                data: { 
                    read: true,
                    readAt: new Date()
                }
            });
            notification.read = true;
            notification.readAt = new Date();
        }

        const serializedNotification = convertBigIntToString(notification);

        res.json({
            success: true,
            notification: serializedNotification
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
        const notificationId = BigInt(req.params.id);

        const notification = await prisma.notification.update({
            where: {
                id: notificationId,
                userId: req.user.id // Ensure user can only mark their own notifications as read
            },
            data: {
                read: true,
                readAt: new Date()
            }
        });

        if (!notification) {
            return res.status(404).json({
                error: 'Notification not found'
            });
        }

        const serializedNotification = convertBigIntToString(notification);

        res.json({
            success: true,
            message: 'Notification marked as read',
            notification: serializedNotification
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
        const result = await prisma.notification.updateMany({
            where: {
                userId: req.user.id,
                read: false
            },
            data: {
                read: true,
                readAt: new Date()
            }
        });

        res.json({
            success: true,
            message: 'All notifications marked as read',
            count: result.count
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
        const notificationId = BigInt(req.params.id);

        const notification = await prisma.notification.delete({
            where: {
                id: notificationId,
                userId: req.user.id // Ensure user can only delete their own notifications
            }
        });

        if (!notification) {
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
        const result = await prisma.notification.deleteMany({
            where: {
                userId: req.user.id,
                read: true
            }
        });

        res.json({
            success: true,
            message: 'All read notifications deleted',
            count: result.count
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

        const [total, unread, today, thisWeek, thisMonth] = await Promise.all([
            prisma.notification.count({ where: { userId: req.user.id } }),
            prisma.notification.count({ where: { userId: req.user.id, read: false } }),
            prisma.notification.count({ 
                where: { 
                    userId: req.user.id,
                    createdAt: { gte: startOfDay }
                }
            }),
            prisma.notification.count({ 
                where: { 
                    userId: req.user.id,
                    createdAt: { gte: startOfWeek }
                }
            }),
            prisma.notification.count({ 
                where: { 
                    userId: req.user.id,
                    createdAt: { gte: startOfMonth }
                }
            })
        ]);

        // Count by type
        const byType = await prisma.notification.groupBy({
            by: ['type'],
            where: { userId: req.user.id },
            _count: true
        });

        // Last 7 days activity
        const last7Days = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
            const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);

            const count = await prisma.notification.count({
                where: {
                    userId: req.user.id,
                    createdAt: {
                        gte: start,
                        lt: end
                    }
                }
            });

            last7Days.push({
                date: date.toISOString().split('T')[0],
                count
            });
        }

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
                    count: item._count
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

        // Convert string IDs to BigInt
        const bigIntIds = notificationIds.map(id => BigInt(id));

        const result = await prisma.notification.updateMany({
            where: {
                id: { in: bigIntIds },
                userId: req.user.id // Security check
            },
            data: {
                read: true,
                readAt: new Date()
            }
        });

        res.json({
            success: true,
            message: 'Notifications marked as read',
            count: result.count
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
        const notificationId = BigInt(req.params.id);

        const notification = await prisma.notification.findUnique({
            where: {
                id: notificationId,
                userId: req.user.id
            }
        });

        if (!notification) {
            return res.status(404).json({
                error: 'Notification not found'
            });
        }

        const updatedNotification = await prisma.notification.update({
            where: { id: notificationId },
            data: {
                read: !notification.read,
                readAt: notification.read ? null : new Date()
            }
        });

        const serializedNotification = convertBigIntToString(updatedNotification);

        res.json({
            success: true,
            message: `Notification marked as ${updatedNotification.read ? 'read' : 'unread'}`,
            notification: serializedNotification
        });

    } catch (error) {
        console.error('Toggle read error:', error);
        res.status(500).json({
            error: 'Failed to toggle notification read status'
        });
    }
});

module.exports = router;