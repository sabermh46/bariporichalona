/**
 * In-app notification helpers.
 * Call these fire-and-forget from controllers: fn().catch(e => console.error(e))
 *
 * Notification types: 'info' | 'success' | 'warning' | 'error'
 *
 * @typedef {{ title: string, message: string, type?: string, redirectLink?: string, data?: object }} NotifOpts
 */

const crypto = require('crypto');
const db = require('../config/knex');

/**
 * Insert one notification row into the database.
 * @param {{ userId?: number|bigint|null } & NotifOpts} opts
 */
async function _insert({ userId = null, title, message, type = 'info', redirectLink = '', data = {} }) {
    const payload = {
        uuid: crypto.randomUUID(),
        userId: userId != null ? String(userId) : null,
        title: String(title).trim(),
        message: String(message).trim(),
        type,
        metadata: JSON.stringify({ ...(data || {}), redirectLink: redirectLink || '' }),
        read: false,
        createdAt: new Date(),
    };
    try {
        await db('notification').insert(payload);
    } catch (err) {
        console.error('[inAppNotification] INSERT failed:', err.message, '| payload:', JSON.stringify({ ...payload, uuid: '(omitted)' }));
        throw err;
    }
}

/**
 * Send a notification to a single user.
 * @param {number|bigint} userId
 * @param {NotifOpts} opts
 */
async function notifyUser(userId, opts) {
    if (userId == null) return;
    await _insert({ userId, ...opts });
}

/**
 * Send notifications to multiple users in parallel.
 * @param {Array<number|bigint>} userIds
 * @param {NotifOpts} opts
 */
async function notifyUsers(userIds, opts) {
    const ids = [...new Set((userIds || []).filter(Boolean).map(String))];
    if (ids.length === 0) return;
    await Promise.all(ids.map((uid) => _insert({ userId: uid, ...opts })));
}

/**
 * Notify the house owner AND all currently-active caretakers of the house.
 * Pass excludeUserId to skip the user who triggered the event (avoid self-notify).
 * @param {number|bigint} houseId
 * @param {NotifOpts} opts
 * @param {number|bigint|null} [excludeUserId]
 */
async function notifyHouseStakeholders(houseId, opts, excludeUserId = null) {
    const [house, caretakerRows] = await Promise.all([
        db('house').where('id', houseId).select('ownerId').first(),
        db('caretakerassignment')
            .where('houseId', houseId)
            .where(function () {
                this.where('expiresAt', '>', new Date()).orWhereNull('expiresAt');
            })
            .select('caretakerId'),
    ]);

    const ownerId = house ? house.ownerId : null;
    const caretakerIds = caretakerRows.map((r) => r.caretakerId);
    const all = [ownerId, ...caretakerIds].filter(Boolean);

    const toNotify = excludeUserId
        ? all.filter((id) => String(id) !== String(excludeUserId))
        : all;

    if (toNotify.length === 0) {
        console.log(`[inAppNotification] notifyHouseStakeholders: no recipients for house ${houseId} (ownerId=${ownerId}, excludeUserId=${excludeUserId}, caretakers=${caretakerIds.length})`);
        return;
    }

    await notifyUsers(toNotify, opts);
}

module.exports = { notifyUser, notifyUsers, notifyHouseStakeholders };
