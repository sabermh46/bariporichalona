// src/services/push.service.js
const db = require("../config/knex");

class PushService {
    async removeAllPushSubscription(userId) {
        try {
            if (!userId) {
                throw new Error("User ID is required to remove push subscriptions.");
            }
            
            const result = await db('pushsubscription')
                .where({ userId: BigInt(userId) })
                .delete();
            
            return result;
        } catch (error) {
            console.error("Error removing push subscription:", error);
            throw error;
        }
    }

    async getUserSubscriptions(userId) {
        try {
            const subscriptions = await db('pushsubscription')
                .where({ userId: BigInt(userId) })
                .select('*');
            
            return subscriptions.map(sub => ({
                ...sub,
                id: sub.id.toString(),
                userId: sub.userId.toString()
            }));
        } catch (error) {
            console.error("Error getting user subscriptions:", error);
            throw error;
        }
    }

    async cleanupExpiredSubscriptions() {
        try {
            const result = await db('pushsubscription')
                .where('expiresAt', '<', new Date())
                .delete();
            
            console.log(`Cleaned up ${result} expired subscriptions`);
            return result;
        } catch (error) {
            console.error("Error cleaning up expired subscriptions:", error);
            throw error;
        }
    }
}

module.exports = new PushService();