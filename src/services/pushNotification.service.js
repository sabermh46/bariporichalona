// src/services/pushNotification.service.js
const webPush = require('web-push');
const db = require("../config/knex");
const crypto = require('crypto');

class PushNotificationService {
    constructor() {
        const publicVapidKey = process.env.VAPID_PUBLIC_KEY;
        const privateVapidKey = process.env.VAPID_PRIVATE_KEY;

        webPush.setVapidDetails(
            `mailto:${process.env.ADMIN_EMAIL || 'admin@bariporichalona.com'}`,
            publicVapidKey,
            privateVapidKey
        );

        this.webPush = webPush;
    }

    // Detect client type from user agent 
    detectClientType(userAgent) {
        if (!userAgent) return 'desktop';

        const mobileRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Windows Phone/i;
        return mobileRegex.test(userAgent) ? 'mobile' : 'desktop';
    }

    // Save or update subscription
     async saveSubscription(userId, subscription, userAgent) {
        const clientType = this.detectClientType(userAgent);

        try {
            const userIdBigInt = BigInt(userId);

            // Check if subscription already exists (by endpoint)
            const existing = await db('pushsubscription')
                .where({ endpoint: subscription.endpoint })
                .first();

            if (existing) {
                // If subscription exists for a different user, we have a conflict
                if (existing.userId.toString() !== userIdBigInt.toString()) {
                    // Delete the old subscription and create a new one
                    await db('pushsubscription')
                        .where({ id: existing.id })
                        .delete();

                    const [newSubscriptionId] = await db('pushsubscription').insert({
                        userId: userIdBigInt,
                        endpoint: subscription.endpoint,
                        p256dh: subscription.keys.p256dh,
                        auth: subscription.keys.auth,
                        userAgent,
                        clientType,
                        createdAt: new Date(),
                        lastUsed: new Date()
                    });

                    return await db('pushsubscription')
                        .where({ id: newSubscriptionId })
                        .first();
                } else {
                    // Update existing subscription for same user
                    await db('pushsubscription')
                        .where({ id: existing.id })
                        .update({
                            p256dh: subscription.keys.p256dh,
                            auth: subscription.keys.auth,
                            userAgent,
                            clientType,
                            lastUsed: new Date()
                            // Removed: updatedAt: new Date() - column doesn't exist
                        });

                    return await db('pushsubscription')
                        .where({ id: existing.id })
                        .first();
                }
            }

            // Check user's existing subscriptions
            const userSubscriptions = await db('pushsubscription')
                .where({ userId: userIdBigInt })
                .orderBy('lastUsed', 'desc');

            // If user has 2 subscriptions already, replace the least used one of same type
            if (userSubscriptions.length >= 2) {
                const sameTypeSubs = userSubscriptions.filter(sub => sub.clientType === clientType);

                if (sameTypeSubs.length > 0) {
                    // Replace the oldest same-type subscription
                    const oldestSameType = sameTypeSubs[sameTypeSubs.length - 1];
                    await db('pushsubscription')
                        .where({ id: oldestSameType.id })
                        .update({
                            endpoint: subscription.endpoint,
                            p256dh: subscription.keys.p256dh,
                            auth: subscription.keys.auth,
                            userAgent,
                            lastUsed: new Date()
                            // Removed: updatedAt: new Date() - column doesn't exist
                        });

                    return await db('pushsubscription')
                        .where({ id: oldestSameType.id })
                        .first();
                } else {
                    // Replace the oldest subscription overall
                    const oldestSubscription = userSubscriptions[userSubscriptions.length - 1];
                    await db('pushsubscription')
                        .where({ id: oldestSubscription.id })
                        .update({
                            endpoint: subscription.endpoint,
                            p256dh: subscription.keys.p256dh,
                            auth: subscription.keys.auth,
                            userAgent,
                            clientType,
                            lastUsed: new Date()
                            // Removed: updatedAt: new Date() - column doesn't exist
                        });

                    return await db('pushsubscription')
                        .where({ id: oldestSubscription.id })
                        .first();
                }
            }

            // Create new subscription
            const [subscriptionId] = await db('pushsubscription').insert({
                userId: userIdBigInt,
                endpoint: subscription.endpoint,
                p256dh: subscription.keys.p256dh,
                auth: subscription.keys.auth,
                userAgent,
                clientType,
                createdAt: new Date(),
                lastUsed: new Date()
            });

            return await db('pushsubscription')
                .where({ id: subscriptionId })
                .first();

        } catch (error) {
            console.error('Error saving subscription:', error);
            throw error;
        }
    }

    async removeSubscription(endpoint) {
        return await db('pushsubscription')
            .where({ endpoint: endpoint })
            .delete();
    }

    // Send notification to a single user
    async sendToUser(userId, title, body, data = {}) {
    try {
        const userIdBigInt = BigInt(userId);

        // 1. Get all active subscriptions for the user
        const subscriptions = await db('pushsubscription')
            .where({ userId: userIdBigInt })
            .select('*');

        console.log(`Found ${subscriptions.length} subscriptions for user ${userId}`);

        if (subscriptions.length === 0) {
            return {
                success: false,
                message: 'No active subscriptions for this user.'
            };
        }

        // 2. Prepare the clean notification data for JSON
        const notificationData = {
            url: data.url || '/dashboard',
            type: data.type || 'general',
            timestamp: Date.now(),
            userId: userId.toString() // Include userId for tracking
        };

        // Add extra safe metadata
        for (const key in data) {
            if (key !== 'url' && key !== 'type') {
                try {
                    JSON.stringify(data[key]);
                    notificationData[key] = data[key];
                } catch (e) {
                    console.warn(`Skipping unsafe data key: ${key}`, e.message);
                }
            }
        }

        const notificationPayload = {
            title: title,
            body: body,
            icon: '/icon-192x192.png',
            badge: '/badge-72x72.png',
            vibrate: [100, 50, 100],
            data: notificationData,
            actions: [
                { action: 'view', title: 'View Details' },
                { action: 'dismiss', title: 'Dismiss' }
            ]
        };

        const results = [];

        // 3. Loop through subscriptions and attempt delivery
        for (const subscription of subscriptions) {
            let success = false;
            let errorMessage = null;
            let statusCode = null;

            try {
                const pushSubscription = {
                    endpoint: subscription.endpoint,
                    keys: {
                        p256dh: subscription.p256dh,
                        auth: subscription.auth
                    }
                };

                await this.webPush.sendNotification(
                    pushSubscription,
                    JSON.stringify(notificationPayload)
                );
                success = true;
            } catch (error) {
                success = false;
                errorMessage = error.message;
                statusCode = error.statusCode;
                console.error(`Send failed for subscription ${subscription.id}:`, errorMessage);
            }

            // --- CRITICAL FIX: LOG FIRST ---
            // Create the log while subscription.id still exists in the database
            try {
                await db('pushnotificationlog').insert({
                    userId: userIdBigInt,
                    title,
                    body,
                    data: JSON.stringify(notificationData),
                    subscriptionId: subscription.id, // Parent exists at this moment
                    sentAt: new Date(),
                    delivered: success,
                    deliveredAt: success ? new Date() : null,
                    error: errorMessage
                });
            } catch (logError) {
                console.error('Failed to create log:', logError.message);
            }

            // --- CRITICAL FIX: DELETE SECOND ---
            // Now that the log is safely created, we can remove the invalid subscription
            if (!success && (statusCode === 410 || statusCode === 404)) {
                try {
                    await db('pushsubscription')
                        .where({ id: subscription.id })
                        .delete();
                    console.log(`Removed invalid subscription: ${subscription.id}`);
                } catch (deleteError) {
                    console.error(`Failed to delete subscription ${subscription.id}:`, deleteError.message);
                }
            }

            results.push({
                success,
                subscriptionId: subscription.id.toString(),
                clientType: subscription.clientType,
                error: errorMessage
            });
        }

        // 4. Create in-app notification record
        const [notificationId] = await db('notification').insert({
            uuid: crypto.randomUUID(),
            userId: userIdBigInt,
            title: title,
            message: body,
            type: data.type || 'info',
            metadata: JSON.stringify(notificationData),
            pushSent: results.some(r => r.success),
            pushError: results.every(r => !r.success) ? 'All delivery attempts failed' : null,
            createdAt: new Date()
        });

        return {
            success: results.some(r => r.success),
            results: results,
            notificationId: notificationId.toString(),
            totalSubscriptions: subscriptions.length,
            successfulDeliveries: results.filter(r => r.success).length
        };

    } catch (error) {
        console.error("Error in sendToUser:", error);
        return {
            success: false,
            error: error.message,
            results: []
        };
    }
}

    async sendToRole(roleSlug, title, body, data = {}) {
        try {
            const users = await db('user')
                .join('role', 'user.roleId', 'role.id')
                .where('role.slug', roleSlug)
                .where('user.status', 'active')
                .select('user.id');

            const results = [];

            for (const user of users) {
                try {
                    const result = await this.sendToUser(user.id.toString(), title, body, data);
                    results.push({
                        userId: user.id.toString(),
                        ...result
                    });
                } catch (error) {
                    results.push({
                        userId: user.id.toString(),
                        success: false,
                        error: error.message
                    });
                }
            }

            return {
                totalUsers: users.length,
                results: results
            };

        } catch (error) {
            console.error("Error in sendToRole:", error);
            throw error;
        }
    }

    async sendToHouseStakeholders(houseId, title, body, data = {}) {
        try {
            const house = await db('house')
                .where({ id: BigInt(houseId) })
                .first();

            if (!house) {
                throw new Error('House not found');
            }

            // Get caretakers for this house
            const caretakers = await db('caretakerassignment')
                .where({ houseId: BigInt(houseId) })
                .select('caretakerId');

            const userIds = [BigInt(house.ownerId)];

            // Add caretakers
            caretakers.forEach(caretaker => {
                userIds.push(BigInt(caretaker.caretakerId));
            });

            // Remove duplicates
            const uniqueUserIds = [...new Set(userIds)];

            const results = [];

            for (const userId of uniqueUserIds) {
                try {
                    const result = await this.sendToUser(userId.toString(), title, body, {
                        ...data,
                        houseId: houseId
                    });
                    results.push({
                        userId: userId.toString(),
                        ...result
                    });
                } catch (error) {
                    results.push({
                        userId: userId.toString(),
                        success: false,
                        error: error.message
                    });
                }
            }

            return {
                houseId: houseId,
                houseAddress: house.address,
                totalStakeholders: uniqueUserIds.length,
                results: results
            };

        } catch (error) {
            console.error("Error in sendToHouseStakeholders:", error);
            throw error;
        }
    }

    // Additional method to clean up duplicate subscriptions
    async cleanupDuplicateSubscriptions() {
        try {
            console.log('Cleaning up duplicate subscriptions...');

            // Find all subscriptions grouped by endpoint
            const allSubscriptions = await db('pushsubscription')
                .orderBy('createdAt', 'desc')
                .select('*');

            const endpointMap = new Map();
            const duplicates = [];

            // Group by endpoint
            for (const sub of allSubscriptions) {
                if (endpointMap.has(sub.endpoint)) {
                    duplicates.push(sub);
                } else {
                    endpointMap.set(sub.endpoint, sub);
                }
            }

            // Delete duplicates
            for (const duplicate of duplicates) {
                console.log(`Deleting duplicate subscription: ${duplicate.id} for user ${duplicate.userId}`);
                await db('pushsubscription')
                    .where({ id: duplicate.id })
                    .delete();
            }

            console.log(`Cleaned up ${duplicates.length} duplicate subscriptions`);
            return { deleted: duplicates.length };

        } catch (error) {
            console.error('Error cleaning up duplicates:', error);
            throw error;
        }
    }

    // Method to fix subscription data (for debugging)
    async fixSubscriptionData(subscriptionId) {
        try {
            const subscription = await db('pushsubscription')
                .where({ id: subscriptionId })
                .first();

            if (!subscription) {
                throw new Error('Subscription not found');
            }

            // Check and fix the subscription
            const fixedData = {
                ...subscription,
                userId: subscription.userId.toString(),
                id: subscription.id.toString()
            };

            return fixedData;
        } catch (error) {
            console.error('Error fixing subscription data:', error);
            throw error;
        }
    }

    // Method to get user subscriptions for debugging
    async getUserSubscriptionsDebug(userId) {
        try {
            const userIdBigInt = BigInt(userId);
            const subscriptions = await db('pushsubscription')
                .where({ userId: userIdBigInt })
                .select('*');

            // Convert BigInt to strings
            return subscriptions.map(sub => ({
                ...sub,
                id: sub.id.toString(),
                userId: sub.userId.toString()
            }));
        } catch (error) {
            console.error('Error getting user subscriptions:', error);
            throw error;
        }
    }

    async getNotificationStats(userId = null) {
        try {
            let query = db('notification');
            
            if (userId) {
                query = query.where({ userId: BigInt(userId) });
            }
            
            const total = await query.clone().count('* as count').first();
            const read = await query.clone().where({ read: true }).count('* as count').first();
            const sent = await query.clone().where({ pushSent: true }).count('* as count').first();
            
            return {
                total: parseInt(total.count),
                read: parseInt(read.count),
                unread: parseInt(total.count) - parseInt(read.count),
                pushSent: parseInt(sent.count),
                pushFailed: parseInt(total.count) - parseInt(sent.count)
            };
        } catch (error) {
            console.error('Error getting notification stats:', error);
            throw error;
        }
    }
}

module.exports = new PushNotificationService();