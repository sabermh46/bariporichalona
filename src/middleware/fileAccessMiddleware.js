// middleware/fileAccessMiddleware.js
const db = require('../config/knex');
const path = require('path');
const fs = require('fs');
const { hasPermission } = require('../services/permission.service');
const CaretakerPermissionService = require('../services/CaretakerPermission.service');

const fileAccessMiddleware = async (req, res, next) => {
    try {
        // req.path is the portion AFTER the mount point (/uploads), e.g. /renters/1/nid_front.jpg
        const filePath = req.path;

        // Extract folder and file info
        const parts = filePath.split('/').filter(Boolean); // remove empty strings from leading slash
        if (parts.length < 2) {
            return res.status(404).json({ error: 'File not found' });
        }

        const category = parts[0]; // renters, pdfs, houses, etc.
        const identifier = parts[1]; // renter id, pdf id, etc.

        // Check if file exists
        const fullPath = path.join(process.cwd(), 'uploads', ...parts);
        if (!fs.existsSync(fullPath)) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        const userId = req.user?.id;
        const userRole = req.user?.role?.slug;
        
        // Web owner can access everything
        if (userRole === 'web_owner') {
            return next();
        }
        
        // For renter files
        if (category === 'renters') {
            const renterId = identifier;
            
            // Check if user is the creator of the renter
            const renter = await db('renter')
                .where('id', renterId)
                .select('createdBy')
                .first();
            
            if (!renter) {
                return res.status(404).json({ error: 'Renter not found' });
            }
            
            // If user created the renter, they can access
            if (String(renter.createdBy) === String(userId)) {
                return next();
            }

            // Check if user is house owner (creator of renter is house owner)
            const houseOwner = await db('user')
                .where('id', renter.createdBy)
                .select('parentId')
                .first();

            if (String(houseOwner?.parentId) === String(userId)) {
                return next();
            }

            // Staff with renters.view permission
            if (userRole === 'staff') {
                const allowed = await hasPermission(userId, 'renters.view');
                if (allowed) return next();
            }

            // Caretaker assigned to any house belonging to the renter's owner
            if (userRole === 'caretaker') {
                const ownerHouses = await db('house').where('ownerId', renter.createdBy).select('id');
                const ownerHouseIds = ownerHouses.map(h => h.id);
                const allowedHouseIds = await CaretakerPermissionService.getHousesWithPermission(userId, ownerHouseIds, 'renters.view');
                if (allowedHouseIds.length > 0) return next();
            }
        }
        
        // PDF invoices – accessible to the house owner, their staff, or the renter themselves
        if (category === 'pdfs') {
            const userId = req.user?.id;
            const userRole = req.user?.role?.slug;
            if (!userId) return res.status(401).json({ error: 'Unauthorised' });
            if (userRole === 'web_owner' || userRole === 'house_owner') return next();

            // identifier is the rent_payment id
            const payment = await db('rent_payment')
                .where('rent_payment.id', identifier)
                .leftJoin('flat', 'rent_payment.flat_id', 'flat.id')
                .leftJoin('house', 'flat.house_id', 'house.id')
                .select('house.ownerId', 'flat.renter_id', 'flat.house_id as houseId')
                .first();

            if (!payment) return res.status(404).json({ error: 'File not found' });
            if (String(payment.ownerId) === String(userId) || String(payment.renter_id) === String(userId)) return next();

            // Staff with payments.view permission
            if (userRole === 'staff') {
                const allowed = await hasPermission(userId, 'payments.view');
                if (allowed) return next();
            }

            // Caretaker assigned to that house
            if (userRole === 'caretaker' && payment.houseId) {
                const allowed = await CaretakerPermissionService.hasCaretakerPermission(userId, payment.houseId, 'payments.view');
                if (allowed) return next();
            }

            return res.status(403).json({ error: 'Access denied' });
        }

        // House / flat images – anyone authenticated can view (images are not PII)
        if (category === 'houses' || category === 'flats') {
            return next();
        }

        // Avatar / profile pictures — access rules vary by target user's role
        if (category === 'avatars') {
            const targetUserId = parseInt(identifier, 10);
            if (!targetUserId) return res.status(404).json({ error: 'File not found' });

            // Self can always view own avatar (compare as numbers — userId from JWT may be string)
            if (parseInt(userId, 10) === targetUserId) return next();

            // Look up target user's role
            const targetUser = await db('user')
                .join('role', 'user.roleId', 'role.id')
                .where('user.id', targetUserId)
                .select('role.slug as roleSlug')
                .first();

            if (!targetUser) return res.status(404).json({ error: 'User not found' });

            const targetRole = targetUser.roleSlug;

            if (targetRole === 'web_owner') {
                // web_owner avatar: only viewable by self (handled above)
                return res.status(403).json({ error: 'Access denied' });
            }

            // house_owner, caretaker, staff avatars: viewable by self (above), staff, web_owner
            if (userRole === 'staff') return next();

            return res.status(403).json({ error: 'Access denied' });
        }

        // For any other categories, deny by default
        return res.status(403).json({ error: 'Access denied' });

    } catch (error) {
        console.error('File access middleware error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

module.exports = fileAccessMiddleware;