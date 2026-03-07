const crypto = require('crypto');
const db = require('../config/knex');
const { serializeBigInt } = require('../utils/serializer');

/** Notification type for system-wide messages visible to web_owner/staff. */
const TYPE_SYSTEM_COMMON = 'system_common';

/**
 * Controller for notification operations.
 * Uses Knex for database interactions.
 */
class NotificationController {

    constructor() {
        this.list = this.list.bind(this);
        this.getById = this.getById.bind(this);
        this.markAsRead = this.markAsRead.bind(this);
        this.markAllAsRead = this.markAllAsRead.bind(this);
        this.deleteById = this.deleteById.bind(this);
        this.deleteAllRead = this.deleteAllRead.bind(this);
        this.getStatsSummary = this.getStatsSummary.bind(this);
        this.batchMarkAsRead = this.batchMarkAsRead.bind(this);
        this.toggleRead = this.toggleRead.bind(this);
        this.createSystemCommonNotification = this.createSystemCommonNotification.bind(this);
    }

    /**
     * Whether the current user sees system_common notifications (web_owner or staff).
     */
    _seesSystemCommon(roleSlug) {
        return roleSlug === 'web_owner' || roleSlug === 'staff';
    }

    /**
     * Base "visible notifications" query for list/counts: for web_owner/staff includes
     * type=system_common (userId null) plus user's own; otherwise only user's own.
     */
    _baseListQuery(userId, roleSlug) {
        const q = db('notification');
        if (this._seesSystemCommon(roleSlug)) {
            return q.where((builder) => {
                builder
                    .where((b) => b.where('type', TYPE_SYSTEM_COMMON).whereNull('userId'))
                    .orWhere('userId', userId);
            });
        }
        return q.where('userId', userId);
    }

    /**
     * Parse notification payload from row (supports both `data` and `metadata` columns).
     */
    _getNotificationPayload(notification) {
        const raw = notification.metadata != null ? notification.metadata : notification.data;
        if (raw == null) return null;
        try {
            return typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch {
            return null;
        }
    }

    /**
     * Format a notification row (with optional user join) into API shape.
     * Includes redirectLink from payload when present.
     */
    _formatNotification(notification) {
        const payload = this._getNotificationPayload(notification);
        const data = payload && typeof payload === 'object' ? payload : null;
        return {
            id: notification.id,
            userId: notification.userId,
            type: notification.type,
            title: notification.title,
            message: notification.message,
            data: data,
            redirectLink: data && typeof data.redirectLink === 'string' ? data.redirectLink : '',
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
    }

    /**
     * Get user notifications with pagination and filters.
     * For web_owner/staff: includes system_common notifications plus user's own, in one sorted list.
     */
    async list(req, res) {
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
            const roleSlug = req.user.role && req.user.role.slug ? req.user.role.slug : null;

            let query = this._baseListQuery(req.user.id, roleSlug);

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

            const notifications = await query
                .clone()
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

            const baseForCount = this._baseListQuery(req.user.id, roleSlug);
            const [totalResult] = await baseForCount.clone().count('* as total');
            const [unreadResult] = await baseForCount.clone()
                .where('read', false)
                .count('* as count');

            const total = parseInt(totalResult.total);
            const unreadCount = parseInt(unreadResult.count);

            const formattedNotifications = notifications.map(n => this._formatNotification(n));

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
            res.status(500).json({ error: 'Failed to fetch notifications' });
        }
    }

    /**
     * Get a single notification by ID; marks it as read when fetched.
     */
    async getById(req, res) {
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
                return res.status(404).json({ error: 'Notification not found' });
            }

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

            const formatted = this._formatNotification(notification);
            res.json({
                success: true,
                notification: serializeBigInt(formatted)
            });
        } catch (error) {
            console.error('Get notification error:', error);
            res.status(500).json({ error: 'Failed to fetch notification' });
        }
    }

    /**
     * Mark a single notification as read.
     */
    async markAsRead(req, res) {
        try {
            const notificationId = req.params.id;

            const updatedCount = await db('notification')
                .where({
                    id: notificationId,
                    userId: req.user.id
                })
                .update({
                    read: true,
                    readAt: new Date()
                });

            if (updatedCount === 0) {
                return res.status(404).json({ error: 'Notification not found' });
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
            res.status(500).json({ error: 'Failed to mark notification as read' });
        }
    }

    /**
     * Mark all notifications as read for the current user.
     */
    async markAllAsRead(req, res) {
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
            res.status(500).json({ error: 'Failed to mark all notifications as read' });
        }
    }

    /**
     * Delete a single notification.
     */
    async deleteById(req, res) {
        try {
            const notificationId = req.params.id;

            const deletedCount = await db('notification')
                .where({
                    id: notificationId,
                    userId: req.user.id
                })
                .del();

            if (deletedCount === 0) {
                return res.status(404).json({ error: 'Notification not found' });
            }

            res.json({
                success: true,
                message: 'Notification deleted successfully'
            });
        } catch (error) {
            console.error('Delete notification error:', error);
            res.status(500).json({ error: 'Failed to delete notification' });
        }
    }

    /**
     * Delete all read notifications for the current user.
     */
    async deleteAllRead(req, res) {
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
            res.status(500).json({ error: 'Failed to delete read notifications' });
        }
    }

    /**
     * Get notification statistics summary.
     * Uses same visibility as list (system_common + own for web_owner/staff).
     */
    async getStatsSummary(req, res) {
        try {
            const now = new Date();
            const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const userId = req.user.id;
            const roleSlug = req.user.role && req.user.role.slug ? req.user.role.slug : null;
            const baseQuery = () => this._baseListQuery(userId, roleSlug);

            const [total, unread, today, thisWeek, thisMonth, byType, last7Days] = await Promise.all([
                baseQuery()
                    .count('* as total')
                    .then(result => parseInt(result[0].total)),

                baseQuery()
                    .where('read', false)
                    .count('* as count')
                    .then(result => parseInt(result[0].count)),

                baseQuery()
                    .where('createdAt', '>=', startOfDay)
                    .count('* as count')
                    .then(result => parseInt(result[0].count)),

                baseQuery()
                    .where('createdAt', '>=', startOfWeek)
                    .count('* as count')
                    .then(result => parseInt(result[0].count)),

                baseQuery()
                    .where('createdAt', '>=', startOfMonth)
                    .count('* as count')
                    .then(result => parseInt(result[0].count)),

                baseQuery()
                    .select('type')
                    .count('* as count')
                    .groupBy('type'),

                (async () => {
                    const days = [];
                    for (let i = 6; i >= 0; i--) {
                        const date = new Date();
                        date.setDate(date.getDate() - i);
                        const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
                        const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
                        const [result] = await baseQuery()
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
            res.status(500).json({ error: 'Failed to fetch notification statistics' });
        }
    }

    /**
     * Mark multiple notifications as read by IDs.
     */
    async batchMarkAsRead(req, res) {
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
            res.status(500).json({ error: 'Failed to mark notifications as read' });
        }
    }

    /**
     * Toggle read status of a notification.
     */
    async toggleRead(req, res) {
        try {
            const notificationId = req.params.id;

            const notification = await db('notification')
                .where({
                    id: notificationId,
                    userId: req.user.id
                })
                .first();

            if (!notification) {
                return res.status(404).json({ error: 'Notification not found' });
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
            res.status(500).json({ error: 'Failed to toggle notification read status' });
        }
    }

    /**
     * Create a system-wide common notification (visible to web_owner/staff).
     * Call this from services or other controllers when you need to broadcast a system message.
     *
     * @param {Object} options
     * @param {string} options.title - Required. Notification title.
     * @param {string} options.message - Required. Notification message.
     * @param {string} [options.redirectLink=''] - Optional. Link to open when notification is used.
     * @param {Object} [options.data={}] - Optional. Extra payload merged into metadata (redirectLink overrides if both).
     * @returns {Promise<{ id: number|bigint, title: string, message: string, type: string }>} Created notification summary.
     * @throws {Error} If title/message missing or insert fails.
     */
    async createSystemCommonNotification(options = {}) {
        const { title, message, redirectLink = '', data = {} } = options;

        if (title == null || String(title).trim() === '') {
            throw new Error('createSystemCommonNotification: title is required and must be non-empty');
        }
        if (message == null || String(message).trim() === '') {
            throw new Error('createSystemCommonNotification: message is required and must be non-empty');
        }

        const metadata = {
            ...(typeof data === 'object' && data !== null ? data : {}),
            redirectLink: typeof redirectLink === 'string' ? redirectLink : ''
        };

        try {
            const insertPayload = {
                uuid: crypto.randomUUID(),
                type: TYPE_SYSTEM_COMMON,
                userId: null,
                title: String(title).trim(),
                message: String(message).trim(),
                metadata: JSON.stringify(metadata),
                read: false,
                createdAt: new Date()
            };

            const [id] = await db('notification').insert(insertPayload);

            return {
                id,
                title: insertPayload.title,
                message: insertPayload.message,
                type: TYPE_SYSTEM_COMMON,
                redirectLink: metadata.redirectLink
            };
        } catch (err) {
            console.error('createSystemCommonNotification error:', err);
            throw new Error(`Failed to create system common notification: ${err.message}`);
        }
    }
}

const controller = new NotificationController();
controller.TYPE_SYSTEM_COMMON = TYPE_SYSTEM_COMMON;
module.exports = controller;
