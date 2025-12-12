const prisma = require("../config/prisma");

exports.removeAllPushSubscription = async (userId) => {
    try {
        if (!userId) {
            throw new Error("User ID is required to remove push subscriptions.");
        }
        const result = await prisma.pushSubscription.deleteMany({
            where: { userId }
        });
        return result;
    } catch (error) {
        console.error("Error removing push subscription:", error);
        throw error;
    }
}