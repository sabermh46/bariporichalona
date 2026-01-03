const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth.middleware');
const HouseController = require('../controllers/house.controller');
const PermissionService = require('../services/permission.service');
const db = require('../config/knex');
const { checkHouseAccess } = require('../middleware/caretakerPermission.middleware');
// Apply auth middleware to all routes
router.use(authMiddleware);

// Create a new house
router.post('/', async (req, res, next) => {
    try {
        await HouseController.createHouse(req, res);
    } catch (error) {
        next(error);
    }
});

// Get all houses with pagination and filters
router.get('/', async (req, res, next) => {
    try {
        await HouseController.getHouses(req, res);
    } catch (error) {
        next(error);
    }
});

// Get house statistics
router.get('/stats', async (req, res, next) => {
    try {
        await HouseController.getHouseStats(req, res);
    } catch (error) {
        next(error);
    }
});

// Get single house details
router.get('/:id', checkHouseAccess(), async (req, res, next) => {
    try {
        await HouseController.getHouseDetails(req, res);
    } catch (error) {
        next(error);
    }
});

// Update house
router.put('/:id', checkHouseAccess(), async (req, res, next) => {
    try {
        // Check permission for update
        const { id } = req.params;
        const house = await HouseController.getHouseDetailsForPermission(id);
        
        if (!house) {
            return res.status(404).json({
                success: false,
                error: 'House not found'
            });
        }

        const currentUser = req.user;
        let hasPermission = false;

        if (currentUser.role.slug === 'web_owner') {
            hasPermission = true;
        } 
        else if (currentUser.role.slug === 'house_owner') {
            if (house.ownerId !== currentUser.id) {
                return res.status(403).json({
                    success: false,
                    error: 'You can only update your own houses'
                });
            }
            hasPermission = await PermissionService.hasPermission(
                currentUser.id, 
                'houses.edit.own'
            );
        }
        else if (currentUser.role.slug === 'staff') {
            const hasUpdateAnyPermission = await PermissionService.hasPermission(
                currentUser.id,
                'house.update.any'
            );
            
            if (hasUpdateAnyPermission) {
                hasPermission = true;
            } else {
                hasPermission = await PermissionService.hasPermission(
                    currentUser.id,
                    'houses.edit'
                );
                
                if (hasPermission) {
                    const isManaged = await HouseController.checkUserHierarchy(
                        currentUser.id, 
                        house.ownerId
                    );
                    if (!isManaged) {
                        return res.status(403).json({
                            success: false,
                            error: 'You can only update houses of owners under your management'
                        });
                    }
                }
            }
        }

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                error: 'Insufficient permissions to update this house'
            });
        }

        await HouseController.updateHouse(req, res);
    } catch (error) {
        next(error);
    }
});

// Delete house
router.delete('/:id', async (req, res, next) => {
    try {
        // Only web_owner can delete houses
        if (req.user.role.slug !== 'web_owner') {
            return res.status(403).json({
                success: false,
                error: 'Only web owner can delete houses'
            });
        }
        
        await HouseController.deleteHouse(req, res);
    } catch (error) {
        next(error);
    }
});

// Get managed house owners (for staff)
router.get('/owners/managed', async (req, res, next) => {
    try {

        const managedOwners = await HouseController.getManagedUsers(
            req.user.id, 
            'house_owner'
        );
        
        
        const formattedOwners = managedOwners.map(owner => ({
            id: owner.id,
            name: owner.name,
            email: owner.email,
            phone: owner.phone,
            houseCount: owner.metadata?.totalHouses || 0,
            createdAt: owner.createdAt
        }));

        res.json({
            success: true,
            data: formattedOwners
        });
    } catch (error) {
        next(error);
    }
});

// Get house flats
// router.get('/:id/flats', async (req, res, next) => {
//     try {
//         const { id } = req.params;
//         const { page = 1, limit = 20 } = req.query;
        
//         const pageNum = parseInt(page);
//         const limitNum = parseInt(limit);
//         const offset = (pageNum - 1) * limitNum;

//         // Check access
//         const hasAccess = await HouseController.checkHouseAccess(req.user, id);
//         if (!hasAccess) {
//             return res.status(403).json({
//                 success: false,
//                 error: 'You do not have permission to view this house'
//             });
//         }

//         const flats = await db('flat')
//             .where('houseId', id)
//             .leftJoin('renter', 'flat.id', 'renter.flatId')
//             .select(
//                 'flat.*',
//                 'renter.id as renter_id',
//                 'renter.name as renter_name',
//                 'renter.phone as renter_phone',
//                 'renter.status as renter_status'
//             )
//             .limit(limitNum)
//             .offset(offset)
//             .orderBy('flat.floor', 'asc')
//             .orderBy('flat.flatNumber', 'asc');

//         const [totalResult] = await db('flat')
//             .where('houseId', id)
//             .count('* as total');

//         // Group flats by ID
//         const groupedFlats = [];
//         const flatMap = {};

//         flats.forEach(row => {
//             if (!flatMap[row.id]) {
//                 flatMap[row.id] = {
//                     id: row.id,
//                     flatNumber: row.flatNumber,
//                     houseId: row.house_id,
//                     floor: row.floor,
//                     size: row.size,
//                     rentAmount: row.rent_amount,
//                     status: row.status,
//                     metadata: row.metadata ? JSON.parse(row.metadata) : {},
//                     createdAt: row.created_at,
//                     updatedAt: row.updated_at,
//                     renters: []
//                 };
//                 groupedFlats.push(flatMap[row.id]);
//             }

//             if (row.renter_id) {
//                 flatMap[row.id].renters.push({
//                     id: row.renter_id,
//                     name: row.renter_name,
//                     phone: row.renter_phone,
//                     status: row.renter_status
//                 });
//             }
//         });

//         res.json({
//             success: true,
//             data: groupedFlats,
//             pagination: {
//                 total: parseInt(totalResult.total),
//                 page: pageNum,
//                 limit: limitNum,
//                 pages: Math.ceil(parseInt(totalResult.total) / limitNum)
//             }
//         });
//     } catch (error) {
//         next(error);
//     }
// });

// Get house caretakers
router.get('/:id/caretakers', async (req, res, next) => {
    try {
        const { id } = req.params;
        
        // Check access
        const hasAccess = await HouseController.checkHouseAccess(req.user, id);
        if (!hasAccess) {
            return res.status(403).json({
                success: false,
                error: 'You do not have permission to view this house'
            });
        }

        const caretakers = await db('caretakerassignment as ca')
            .where('ca.houseId', id)
            .leftJoin('user as c', 'ca.caretakerId', 'c.id')
            .leftJoin('caretakerassignmentpermission as cap', 'ca.id', 'cap.caretakerAssignmentId')
            .leftJoin('permission as p', 'cap.permissionId', 'p.id')
            .select(
                'ca.*',
                'c.id as caretaker_id',
                'c.name as caretaker_name',
                'c.email as caretaker_email',
                'c.phone as caretaker_phone',
                'p.id as permission_id',
                'p.key as permission_key',
                'p.description as permission_description'
            );

        // Group caretakers and permissions
        const groupedCaretakers = [];
        const caretakerMap = {};

        caretakers.forEach(row => {
            if (!caretakerMap[row.id]) {
                caretakerMap[row.id] = {
                    id: row.id,
                    houseId: row.houseId,
                    caretakerId: row.caretakerId,
                    expiresAt: row.expiresAt,
                    createdAt: row.createdAt,
                    caretaker: {
                        id: row.caretaker_id,
                        name: row.caretaker_name,
                        email: row.caretaker_email,
                        phone: row.caretaker_phone
                    },
                    permissions: []
                };
                groupedCaretakers.push(caretakerMap[row.id]);
            }

            if (row.permission_id) {
                caretakerMap[row.id].permissions.push({
                    id: row.permission_id,
                    key: row.permission_key,
                    description: row.permission_description
                });
            }
        });

        res.json({
            success: true,
            data: groupedCaretakers
        });
    } catch (error) {
        next(error);
    }
});

// In your house routes or flat routes
// router.get('/:houseId/flats', async (req, res) => {
//     try {
//         const { houseId } = req.params;
//         const { page = 1, limit = 20, status } = req.query;
        
//         let query = db('flat')
//             .where('houseId', houseId);

//         if (status === 'occupied') {
//             query = query.whereNotNull('renterId');
//         } else if (status === 'vacant') {
//             query = query.whereNull('renterId');
//         }

//         const flats = await query
//             .leftJoin('renter', 'flat.renterId', 'renter.id')
//             .select(
//                 'flat.*',
//                 'renter.name as renter_name',
//                 'renter.phone as renter_phone',
//                 'renter.status as renter_status'
//             )
//             .orderBy('flat.number', 'asc');

//         // Format response
//         const formattedFlats = flats.map(flat => ({
//             id: flat.id,
//             uuid: flat.uuid,
//             houseId: flat.houseId,
//             number: flat.number,
//             name: flat.name,
//             renterId: flat.renterId,
//             metadata: flat.metadata ? JSON.parse(flat.metadata) : {},
//             createdAt: flat.createdAt,
//             updatedAt: flat.updatedAt,
//             renter: flat.renterId ? {
//                 id: flat.renterId,
//                 name: flat.renter_name,
//                 phone: flat.renter_phone,
//                 status: flat.renter_status
//             } : null
//         }));

//         res.json({
//             success: true,
//             data: formattedFlats
//         });
//     } catch (error) {
//         console.error('Get flats error:', error);
//         res.status(500).json({
//             success: false,
//             error: 'Failed to fetch flats'
//         });
//     }
// });

module.exports = router;