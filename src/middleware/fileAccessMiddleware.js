// middleware/fileAccessMiddleware.js
const db = require('../config/knex');
const path = require('path');
const fs = require('fs');

const fileAccessMiddleware = async (req, res, next) => {
    try {
        const filePath = req.path; // e.g., /uploads/renters/1/nid_front.jpg
        
        // Extract folder and file info
        const parts = filePath.split('/');
        if (parts.length < 4 || parts[1] !== 'uploads') {
            return res.status(404).json({ error: 'File not found' });
        }
        
        const category = parts[2]; // renters
        const identifier = parts[3]; // renter id
        
        // Check if file exists
        const fullPath = path.join(process.cwd(), 'uploads', ...parts.slice(2));
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
            if (renter.createdBy === userId) {
                return next();
            }
            
            // Check if user is house owner (creator of renter is house owner)
            const houseOwner = await db('user')
                .where('id', renter.createdBy)
                .select('parentId')
                .first();
            
            if (houseOwner?.parentId === userId) {
                return next();
            }
            
            // Check if user is staff with nid.preview permission
            if (userRole === 'staff') {
                const hasPermission = await checkPermission(userId, 'nid.preview');
                if (hasPermission) {
                    // Check if staff is assigned to any house where this renter belongs
                    const renterHouses = await db('flat')
                        .where('renter_id', renterId)
                        .select('house_id');
                    
                    const houseIds = renterHouses.map(h => h.house_id);
                    
                    if (houseIds.length > 0) {
                        const caretakerAssignment = await db('caretakerassignment')
                            .whereIn('house_id', houseIds)
                            .andWhere('caretaker_id', userId)
                            .andWhere('expires_at', '>', new Date())
                            .first();
                        
                        if (caretakerAssignment) {
                            return next();
                        }
                    }
                }
            }
            
            // Check if user is caretaker for the house where renter lives
            if (userRole === 'staff') {
                const renterFlat = await db('flat')
                    .where('renter_id', renterId)
                    .select('house_id')
                    .first();
                
                if (renterFlat) {
                    const caretakerAssignment = await db('caretakerassignment')
                        .where('house_id', renterFlat.house_id)
                        .andWhere('caretaker_id', userId)
                        .andWhere('expires_at', '>', new Date())
                        .first();
                    
                    if (caretakerAssignment) {
                        return next();
                    }
                }
            }
        }
        
        // For other categories, add logic as needed
        return res.status(403).json({ error: 'Access denied' });
        
    } catch (error) {
        console.error('File access middleware error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

// Helper function to check permissions
async function checkPermission(userId, permissionKey) {
    try {
        // Check role permissions
        const rolePermission = await db('user')
            .join('role', 'user.roleId', 'role.id')
            .join('rolepermission', 'role.id', 'rolepermission.roleId')
            .join('permission', 'rolepermission.permissionId', 'permission.id')
            .where('user.id', userId)
            .andWhere('permission.key', permissionKey)
            .first();
        
        if (rolePermission) return true;
        
        // Check staff permissions
        const staffPermission = await db('staffpermission')
            .join('permission', 'staffpermission.permissionId', 'permission.id')
            .where('staffpermission.userId', userId)
            .andWhere('staffpermission.revokedAt', null)
            .andWhere('permission.key', permissionKey)
            .first();
        
        return !!staffPermission;
    } catch (error) {
        return false;
    }
}

module.exports = fileAccessMiddleware;