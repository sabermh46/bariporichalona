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
     * Whether a system_common notification has been read by the given user.
     * Checks metadata.readBy array.
     */
    _isSystemCommonReadByUser(payload, userId) {
        if (!payload || !Array.isArray(payload.readBy)) return false;
        const uid = String(userId);
        return payload.readBy.some((id) => String(id) === uid);
    }

    /**
     * Format a notification row (with optional user join) into API shape.
     * For system_common notifications, computes effective read status from metadata.readBy.
     */
    _formatNotification(notification, currentUserId = null) {
        const payload = this._getNotificationPayload(notification);
        const data = payload && typeof payload === 'object' ? payload : null;

        let isRead = Boolean(notification.read);
        if (notification.type === TYPE_SYSTEM_COMMON && currentUserId != null) {
            isRead = this._isSystemCommonReadByUser(data, currentUserId);
        }

        return {
            id: notification.id,
            userId: notification.userId,
            type: notification.type,
            title: notification.title,
            message: notification.message,
            data: data,
            redirectLink: data && typeof data.redirectLink === 'string' ? data.redirectLink : '',
            read: isRead,
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
     * Compute unread count for system_common notifications for the given user.
     * Fetches all system_common rows and filters by readBy in JS (list is always small).
     */
    async _countUnreadSystemCommon(userId) {
        const rows = await db('notification')
            .where('type', TYPE_SYSTEM_COMMON)
            .whereNull('userId')
            .select('metadata');

        return rows.filter((n) => {
            const payload = this._getNotificationPayload(n);
            return !this._isSystemCommonReadByUser(payload, userId);
        }).length;
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
            const currentUserId = req.user.id;
            const canSeeSystemCommon = this._seesSystemCommon(roleSlug);

            let query = this._baseListQuery(currentUserId, roleSlug);

            if (unread === 'true') {
                if (canSeeSystemCommon) {
                    // Can't use simple WHERE read=false because system_common read state is
                    // stored in metadata.readBy. Always include system_common rows here;
                    // they'll be post-filtered after JS read-status resolution.
                    query = query.where((builder) => {
                        builder
                            .where((b) => b.whereNot('type', TYPE_SYSTEM_COMMON).where('read', false))
                            .orWhere((b) => b.where('type', TYPE_SYSTEM_COMMON).whereNull('userId'));
                    });
                } else {
                    query = query.where('read', false);
                }
            }

            if (type) query = query.where('type', type);
            if (startDate) query = query.where('createdAt', '>=', new Date(startDate));
            if (endDate) query = query.where('createdAt', '<=', new Date(endDate));

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

            // Resolve effective read status per user for system_common rows
            let formattedNotifications = notifications.map((n) => this._formatNotification(n, currentUserId));

            // Post-filter: remove system_common rows the current user has already read
            if (unread === 'true' && canSeeSystemCommon) {
                formattedNotifications = formattedNotifications.filter((n) => !n.read);
            }

            // --- Counts ---
            // Own unread count
            const [ownUnreadResult] = await db('notification')
                .where({ userId: currentUserId, read: false })
                .count('* as count');
            let unreadCount = parseInt(ownUnreadResult.count);

            // system_common unread count (per-user, via JS)
            if (canSeeSystemCommon) {
                unreadCount += await this._countUnreadSystemCommon(currentUserId);
            }

            // Total count for pagination (using the same filtered base query)
            const baseForCount = this._baseListQuery(currentUserId, roleSlug);
            let countQuery = baseForCount.clone();
            if (unread === 'true' && canSeeSystemCommon) {
                countQuery = countQuery.where((builder) => {
                    builder
                        .where((b) => b.whereNot('type', TYPE_SYSTEM_COMMON).where('read', false))
                        .orWhere((b) => b.where('type', TYPE_SYSTEM_COMMON).whereNull('userId'));
                });
            } else if (unread === 'true') {
                countQuery = countQuery.where('read', false);
            }
            if (type) countQuery = countQuery.where('type', type);
            if (startDate) countQuery = countQuery.where('createdAt', '>=', new Date(startDate));
            if (endDate) countQuery = countQuery.where('createdAt', '<=', new Date(endDate));

            const [totalResult] = await countQuery.count('* as total');
            const total = parseInt(totalResult.total);

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
            res.status(500).json({ error: 'Failed to fetch notifications||বিজ্ঞপ্তি আনতে ব্যর্থ হয়েছে' });
        }
    }

    /**
     * Get a single notification by ID; marks it as read when fetched.
     * Works for both user-owned and system_common notifications.
     */
    async getById(req, res) {
        try {
            const notificationId = req.params.id;
            const roleSlug = req.user.role && req.user.role.slug ? req.user.role.slug : null;

            let notification = await db('notification as n')
                .where('n.id', notificationId)
                .where((builder) => {
                    builder
                        .where('n.userId', req.user.id)
                        .orWhere((b) => {
                            if (this._seesSystemCommon(roleSlug)) {
                                b.where('n.type', TYPE_SYSTEM_COMMON).whereNull('n.userId');
                            } else {
                                b.whereRaw('1 = 0');
                            }
                        });
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
                return res.status(404).json({ error: 'Notification not found||বিজ্ঞপ্তি খুঁজে পাওয়া যায়নি' });
            }

            if (notification.type === TYPE_SYSTEM_COMMON) {
                const payload = this._getNotificationPayload(notification) || {};
                const readBy = Array.isArray(payload.readBy) ? payload.readBy : [];
                if (!readBy.some((id) => String(id) === String(req.user.id))) {
                    readBy.push(req.user.id);
                    const newMetadata = JSON.stringify({ ...payload, readBy });
                    await db('notification').where('id', notificationId).update({ metadata: newMetadata });
                    notification.metadata = newMetadata;
                }
            } else if (!notification.read) {
                await db('notification')
                    .where('id', notificationId)
                    .update({ read: true, readAt: new Date() });
                notification.read = true;
                notification.readAt = new Date();
            }

            const formatted = this._formatNotification(notification, req.user.id);
            res.json({
                success: true,
                notification: serializeBigInt(formatted)
            });
        } catch (error) {
            console.error('Get notification error:', error);
            res.status(500).json({ error: 'Failed to fetch notification||বিজ্ঞপ্তি আনতে ব্যর্থ হয়েছে' });
        }
    }

    /**
     * Mark a single notification as read.
     * For system_common: adds current user to metadata.readBy.
     * For regular: sets read=true on the record.
     */
    async markAsRead(req, res) {
        try {
            const notificationId = req.params.id;
            const roleSlug = req.user.role && req.user.role.slug ? req.user.role.slug : null;

            const notification = await db('notification').where('id', notificationId).first();

            if (!notification) {
                return res.status(404).json({ error: 'Notification not found||বিজ্ঞপ্তি খুঁজে পাওয়া যায়নি' });
            }

            if (notification.type === TYPE_SYSTEM_COMMON) {
                if (!this._seesSystemCommon(roleSlug)) {
                    return res.status(403).json({ error: 'Not authorized||অনুমোদিত নয়' });
                }

                const payload = this._getNotificationPayload(notification) || {};
                const readBy = Array.isArray(payload.readBy) ? payload.readBy : [];
                if (!readBy.some((id) => String(id) === String(req.user.id))) {
                    readBy.push(req.user.id);
                    const newMetadata = JSON.stringify({ ...payload, readBy });
                    await db('notification').where('id', notificationId).update({ metadata: newMetadata });
                }

                return res.json({
                    success: true,
                    message: 'Notification marked as read',
                    notification: serializeBigInt(await db('notification').where('id', notificationId).first())
                });
            }

            // Regular notification
            const updatedCount = await db('notification')
                .where({ id: notificationId, userId: req.user.id })
                .update({ read: true, readAt: new Date() });

            if (updatedCount === 0) {
                return res.status(404).json({ error: 'Notification not found||বিজ্ঞপ্তি খুঁজে পাওয়া যায়নি' });
            }

            return res.json({
                success: true,
                message: 'Notification marked as read',
                notification: serializeBigInt(await db('notification').where('id', notificationId).first())
            });
        } catch (error) {
            console.error('Mark as read error:', error);
            res.status(500).json({ error: 'Failed to mark notification as read||বিজ্ঞপ্তি পঠিত চিহ্নিত করতে ব্যর্থ হয়েছে' });
        }
    }

    /**
     * Mark all notifications as read for the current user.
     * For system_common: adds current user to readBy on every system_common row.
     */
    async markAllAsRead(req, res) {
        try {
            const roleSlug = req.user.role && req.user.role.slug ? req.user.role.slug : null;

            // Mark user's own notifications
            const ownCount = await db('notification')
                .where({ userId: req.user.id, read: false })
                .update({ read: true, readAt: new Date() });

            let systemCommonCount = 0;
            if (this._seesSystemCommon(roleSlug)) {
                const systemRows = await db('notification')
                    .where('type', TYPE_SYSTEM_COMMON)
                    .whereNull('userId')
                    .select('id', 'metadata');

                for (const notif of systemRows) {
                    const payload = this._getNotificationPayload(notif) || {};
                    const readBy = Array.isArray(payload.readBy) ? payload.readBy : [];
                    if (!readBy.some((id) => String(id) === String(req.user.id))) {
                        readBy.push(req.user.id);
                        await db('notification')
                            .where('id', notif.id)
                            .update({ metadata: JSON.stringify({ ...payload, readBy }) });
                        systemCommonCount++;
                    }
                }
            }

            res.json({
                success: true,
                message: 'All notifications marked as read',
                count: ownCount + systemCommonCount
            });
        } catch (error) {
            console.error('Mark all as read error:', error);
            res.status(500).json({ error: 'Failed to mark all notifications as read||সব বিজ্ঞপ্তি পঠিত চিহ্নিত করতে ব্যর্থ হয়েছে' });
        }
    }

    /**
     * Delete a single notification.
     * Only user-owned notifications can be deleted (system_common cannot).
     */
    async deleteById(req, res) {
        try {
            const notificationId = req.params.id;

            const deletedCount = await db('notification')
                .where({ id: notificationId, userId: req.user.id })
                .del();

            if (deletedCount === 0) {
                return res.status(404).json({ error: 'Notification not found||বিজ্ঞপ্তি খুঁজে পাওয়া যায়নি' });
            }

            res.json({
                success: true,
                message: 'Notification deleted successfully'
            });
        } catch (error) {
            console.error('Delete notification error:', error);
            res.status(500).json({ error: 'Failed to delete notification||বিজ্ঞপ্তি মুছতে ব্যর্থ হয়েছে' });
        }
    }

    /**
     * Delete all read notifications for the current user (user-owned only).
     */
    async deleteAllRead(req, res) {
        try {
            const result = await db('notification')
                .where({ userId: req.user.id, read: true })
                .del();

            res.json({
                success: true,
                message: 'All read notifications deleted',
                count: result
            });
        } catch (error) {
            console.error('Delete all read error:', error);
            res.status(500).json({ error: 'Failed to delete read notifications||পঠিত বিজ্ঞপ্তি মুছতে ব্যর্থ হয়েছে' });
        }
    }

    /**
     * Get notification statistics summary.
     * Unread count accounts for system_common per-user read state.
     */
    async getStatsSummary(req, res) {
        try {
            const now = new Date();
            const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const userId = req.user.id;
            const roleSlug = req.user.role && req.user.role.slug ? req.user.role.slug : null;
            const canSeeSystemCommon = this._seesSystemCommon(roleSlug);
            const baseQuery = () => this._baseListQuery(userId, roleSlug);

            const [total, ownUnread, today, thisWeek, thisMonth, byType, last7Days] = await Promise.all([
                baseQuery().count('* as total').then((r) => parseInt(r[0].total)),

                db('notification').where({ userId, read: false }).count('* as count').then((r) => parseInt(r[0].count)),

                baseQuery().where('createdAt', '>=', startOfDay).count('* as count').then((r) => parseInt(r[0].count)),

                baseQuery().where('createdAt', '>=', startOfWeek).count('* as count').then((r) => parseInt(r[0].count)),

                baseQuery().where('createdAt', '>=', startOfMonth).count('* as count').then((r) => parseInt(r[0].count)),

                baseQuery().select('type').count('* as count').groupBy('type'),

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
                        days.push({ date: date.toISOString().split('T')[0], count: parseInt(result.count) });
                    }
                    return days;
                })()
            ]);

            // Accurate unread: own + system_common not yet read by this user
            let unread = ownUnread;
            if (canSeeSystemCommon) {
                unread += await this._countUnreadSystemCommon(userId);
            }

            res.json({
                success: true,
                stats: {
                    total,
                    unread,
                    today,
                    thisWeek,
                    thisMonth,
                    byType: byType.map((item) => ({ type: item.type, count: parseInt(item.count) })),
                    last7Days
                }
            });
        } catch (error) {
            console.error('Stats error:', error);
            res.status(500).json({ error: 'Failed to fetch notification statistics||বিজ্ঞপ্তির পরিসংখ্যান আনতে ব্যর্থ হয়েছে' });
        }
    }

    /**
     * Mark multiple notifications as read by IDs.
     * Handles a mixed list of regular and system_common notifications.
     */
    async batchMarkAsRead(req, res) {
        try {
            const { notificationIds } = req.body;

            if (!notificationIds || !Array.isArray(notificationIds)) {
                return res.status(400).json({ error: 'notificationIds array is required||বিজ্ঞপ্তি আইডি তালিকা আবশ্যক' });
            }

            const notifications = await db('notification')
                .whereIn('id', notificationIds)
                .select('id', 'type', 'userId', 'metadata');

            const regularIds = [];
            let systemCommonCount = 0;

            for (const notif of notifications) {
                if (notif.type === TYPE_SYSTEM_COMMON) {
                    const payload = this._getNotificationPayload(notif) || {};
                    const readBy = Array.isArray(payload.readBy) ? payload.readBy : [];
                    if (!readBy.some((id) => String(id) === String(req.user.id))) {
                        readBy.push(req.user.id);
                        await db('notification')
                            .where('id', notif.id)
                            .update({ metadata: JSON.stringify({ ...payload, readBy }) });
                        systemCommonCount++;
                    }
                } else if (String(notif.userId) === String(req.user.id)) {
                    regularIds.push(notif.id);
                }
            }

            let regularCount = 0;
            if (regularIds.length > 0) {
                regularCount = await db('notification')
                    .whereIn('id', regularIds)
                    .update({ read: true, readAt: new Date() });
            }

            res.json({
                success: true,
                message: 'Notifications marked as read',
                count: regularCount + systemCommonCount
            });
        } catch (error) {
            console.error('Batch read error:', error);
            res.status(500).json({ error: 'Failed to mark notifications as read||বিজ্ঞপ্তিগুলো পঠিত চিহ্নিত করতে ব্যর্থ হয়েছে' });
        }
    }

    /**
     * Toggle read status of a notification.
     * For system_common: toggles current user's presence in metadata.readBy.
     */
    async toggleRead(req, res) {
        try {
            const notificationId = req.params.id;
            const roleSlug = req.user.role && req.user.role.slug ? req.user.role.slug : null;

            const notification = await db('notification').where('id', notificationId).first();

            if (!notification) {
                return res.status(404).json({ error: 'Notification not found||বিজ্ঞপ্তি খুঁজে পাওয়া যায়নি' });
            }

            if (notification.type === TYPE_SYSTEM_COMMON) {
                if (!this._seesSystemCommon(roleSlug)) {
                    return res.status(403).json({ error: 'Not authorized||অনুমোদিত নয়' });
                }

                const payload = this._getNotificationPayload(notification) || {};
                const readBy = Array.isArray(payload.readBy) ? payload.readBy : [];
                const uid = String(req.user.id);
                const isCurrentlyRead = readBy.some((id) => String(id) === uid);

                const newReadBy = isCurrentlyRead
                    ? readBy.filter((id) => String(id) !== uid)
                    : [...readBy, req.user.id];

                const newMetadata = JSON.stringify({ ...payload, readBy: newReadBy });
                await db('notification').where('id', notificationId).update({ metadata: newMetadata });

                const updated = await db('notification').where('id', notificationId).first();
                return res.json({
                    success: true,
                    message: `Notification marked as ${!isCurrentlyRead ? 'read' : 'unread'}`,
                    notification: serializeBigInt(updated)
                });
            }

            // Regular notification
            const notification2 = await db('notification')
                .where({ id: notificationId, userId: req.user.id })
                .first();

            if (!notification2) {
                return res.status(404).json({ error: 'Notification not found||বিজ্ঞপ্তি খুঁজে পাওয়া যায়নি' });
            }

            const newReadStatus = !notification2.read;
            await db('notification')
                .where('id', notificationId)
                .update({ read: newReadStatus, readAt: newReadStatus ? new Date() : null });

            const updated = await db('notification').where('id', notificationId).first();
            res.json({
                success: true,
                message: `Notification marked as ${newReadStatus ? 'read' : 'unread'}`,
                notification: serializeBigInt(updated)
            });
        } catch (error) {
            console.error('Toggle read error:', error);
            res.status(500).json({ error: 'Failed to toggle notification read status||বিজ্ঞপ্তির পঠিত স্ট্যাটাস পরিবর্তন করতে ব্যর্থ হয়েছে' });
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

        // readBy starts empty — no one has read the new notification yet
        const metadata = {
            ...(typeof data === 'object' && data !== null ? data : {}),
            redirectLink: typeof redirectLink === 'string' ? redirectLink : '',
            readBy: []
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
