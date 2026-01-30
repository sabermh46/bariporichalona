const db = require("../../config/knex");

async function getAccessibleHouseOwners(caretakerId) {
        try {
            const owners = await db('caretakerassignment as ca')
                .join('house as h', 'ca.houseId', 'h.id')
                .where('ca.caretakerId', caretakerId)
                .andWhere(function() {
                    this.where('ca.expiresAt', '>', new Date())
                        .orWhereNull('ca.expiresAt');
                })
                .andWhere('h.active', true)
                .distinct('h.ownerId')
                .pluck('h.ownerId');
            
            return owners.map(id => parseInt(id));
        } catch (error) {
            console.error('Get accessible owners error:', error);
            return [];
        }
    }

module.exports = {
    getAccessibleHouseOwners
};