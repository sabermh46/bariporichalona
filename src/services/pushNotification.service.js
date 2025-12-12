const webPush = require('web-push');
const prisma = require("../config/prisma");
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
            // Convert userId to BigInt for database operations
            const userIdBigInt = BigInt(userId);

            // Check if subscription already exists (by endpoint)
            const existing = await prisma.pushSubscription.findUnique({
                where: { endpoint: subscription.endpoint }
            });

            if (existing) {
                // If subscription exists for a different user, we have a conflict
                if (existing.userId !== userIdBigInt) {
                    // Delete the old subscription and create a new one
                    await prisma.pushSubscription.delete({
                        where: { id: existing.id }
                    });

                    return await prisma.pushSubscription.create({
                        data: {
                            userId: userIdBigInt,
                            endpoint: subscription.endpoint,
                            p256dh: subscription.keys.p256dh,
                            auth: subscription.keys.auth,
                            userAgent,
                            clientType
                        }
                    });
                } else {
                    // Update existing subscription for same user
                    return await prisma.pushSubscription.update({
                        where: { id: existing.id },
                        data: {
                            p256dh: subscription.keys.p256dh,
                            auth: subscription.keys.auth,
                            userAgent,
                            clientType,
                            lastUsed: new Date()
                        }
                    });
                }
            }

            // Check user's existing subscriptions
            const userSubscriptions = await prisma.pushSubscription.findMany({
                where: { userId: userIdBigInt },
                orderBy: { lastUsed: 'desc' }
            });

            // If user has 2 subscriptions already, replace the least used one of same type
            if (userSubscriptions.length >= 2) {
                const sameTypeSubs = userSubscriptions.filter(sub => sub.clientType === clientType);

                if (sameTypeSubs.length > 0) {
                    // Replace the oldest same-type subscription
                    const oldestSameType = sameTypeSubs[sameTypeSubs.length - 1];
                    return await prisma.pushSubscription.update({
                        where: { id: oldestSameType.id },
                        data: {
                            endpoint: subscription.endpoint,
                            p256dh: subscription.keys.p256dh,
                            auth: subscription.keys.auth,
                            userAgent,
                            lastUsed: new Date()
                        }
                    });
                } else {
                    // Replace the oldest subscription overall
                    const oldestSubscription = userSubscriptions[userSubscriptions.length - 1];
                    return await prisma.pushSubscription.update({
                        where: { id: oldestSubscription.id },
                        data: {
                            endpoint: subscription.endpoint,
                            p256dh: subscription.keys.p256dh,
                            auth: subscription.keys.auth,
                            userAgent,
                            clientType,
                            lastUsed: new Date()
                        }
                    });
                }
            }

            // Create new subscription
            return await prisma.pushSubscription.create({
                data: {
                    userId: userIdBigInt,
                    endpoint: subscription.endpoint,
                    p256dh: subscription.keys.p256dh,
                    auth: subscription.keys.auth,
                    userAgent,
                    clientType
                }
            });

        } catch (error) {
            console.error('Error saving subscription:', error);
            throw error;
        }
    }

    async removeSubscription(endpoint) {
        return await prisma.pushSubscription.delete({
            where: { endpoint: endpoint }
        });
    }

    // Helper function to convert BigInt to String
    convertBigIntToString(obj) {
        if (obj === null || obj === undefined) {
            return obj;
        }

        if (typeof obj === 'bigint') {
            return obj.toString();
        }

        if (Array.isArray(obj)) {
            return obj.map(this.convertBigIntToString.bind(this));
        }

        if (typeof obj === 'object' && obj.constructor === Object) {
            const newObj = {};
            for (const key in obj) {
                newObj[key] = this.convertBigIntToString(obj[key]);
            }
            return newObj;
        }

        return obj;
    }

    // Send notification to a single user
async sendToUser(userId, title, body, data = {}) {
    try {
        // Convert userId to BigInt
        const userIdBigInt = BigInt(userId);

        // Get subscriptions
        const subscriptions = await prisma.pushSubscription.findMany({
            where: { userId: userIdBigInt }
        });

        console.log(`Found ${subscriptions.length} subscriptions for user ${userId}`);

        

        if (subscriptions.length === 0) {
            return {
                success: false,
                message: 'No active subscriptions for this user.'
            };
        }

        // Safely prepare data for JSON serialization
        const safeJsonSerialize = (obj) => {
            return JSON.parse(JSON.stringify(obj, (key, value) => {
                if (typeof value === 'bigint') {
                    return value.toString();
                }
                if (value instanceof Date) {
                    return value.toISOString();
                }
                return value;
            }));
        };

        // Create clean notification data
        const notificationData = {
            url: data.url || '/dashboard',
            type: data.type || 'general',
            timestamp: Date.now()
        };

        // Only add extra data if it's safe
        for (const key in data) {
            if (key !== 'url' && key !== 'type') {
                try {
                    // Test if the value can be serialized
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
                {
                    action: 'view',
                    title: 'View Details'
                },
                {
                    action: 'dismiss',
                    title: 'Dismiss'
                }
            ]
        };

        console.log('Notification payload:', safeJsonSerialize(notificationPayload));

        const results = [];
        for (const subscription of subscriptions) {
            let success = false;
            let errorMessage = null;
            
            try {
                // Convert subscription to plain object with stringified BigInts
                const pushSubscription = {
                    endpoint: subscription.endpoint,
                    keys: {
                        p256dh: subscription.p256dh,
                        auth: subscription.auth
                    }
                };

                // Send notification
                await this.webPush.sendNotification(
                    pushSubscription,
                    JSON.stringify(notificationPayload)
                );
                success = true;
                
            } catch (error) {
                errorMessage = error.message;
                console.error(`Send failed for subscription ${subscription.id}:`, errorMessage);
                
                // Remove invalid subscription
                if (error.statusCode === 410 || error.statusCode === 404) {
                    try {
                        await prisma.pushSubscription.delete({
                            where: { id: subscription.id }
                        });
                        console.log(`Removed invalid subscription: ${subscription.id}`);
                    } catch (deleteError) {
                        console.error(`Failed to delete subscription ${subscription.id}:`, deleteError.message);
                    }
                }
            }

            // Log the attempt
            try {
                await prisma.pushNotificationLog.create({
                    data: {
                        userId: userIdBigInt,
                        title,
                        body,
                        data: notificationData,
                        subscriptionId: subscription.id,
                        delivered: success,
                        deliveredAt: success ? new Date() : null,
                        error: errorMessage
                    }
                });
            } catch (logError) {
                console.error('Failed to create log:', logError.message);
            }

            results.push({
                success,
                subscriptionId: subscription.id.toString(),
                clientType: subscription.clientType,
                error: errorMessage
            });
        }

        // Create in-app notification
        const notification = await prisma.notification.create({
            data: {
                uuid: crypto.randomUUID(),
                userId: userIdBigInt,
                title: title,
                message: body,
                type: data.type || 'info',
                metadata: notificationData,
                pushSent: results.some(r => r.success),
                pushError: results.every(r => !r.success) ? 'All delivery attempts failed' : null
            }
        });

        return {
            success: results.some(r => r.success),
            results: results,
            notificationId: notification.id.toString(),
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
            const users = await prisma.user.findMany({
                where: {
                    role: {
                        slug: roleSlug
                    },
                    status: 'active'
                },
                select: {
                    id: true
                }
            });

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
            // Fix: Changed 'owners' to 'owner' since your schema has 'owner' relation
            const house = await prisma.house.findUnique({
                where: { id: houseId },
                include: {
                    owner: true, // Changed from 'owners' to 'owner'
                    caretakers: {
                        include: {
                            caretaker: true
                        }
                    }
                }
            });

            if (!house) {
                throw new Error('House not found');
            }

            const userIds = [house.ownerId];

            // Add caretakers
            house.caretakers.forEach(caretakerRel => {
                userIds.push(caretakerRel.caretakerId);
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
            const allSubscriptions = await prisma.pushSubscription.findMany({
                orderBy: { createdAt: 'desc' }
            });

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
                await prisma.pushSubscription.delete({
                    where: { id: duplicate.id }
                });
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
            const subscription = await prisma.pushSubscription.findUnique({
                where: { id: subscriptionId }
            });

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
            const subscriptions = await prisma.pushSubscription.findMany({
                where: { userId: userIdBigInt }
            });

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
}

module.exports = new PushNotificationService();