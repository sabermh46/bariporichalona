const { v4: uuid } = require("uuid");
const db = require("../config/knex");
const PermissionService = require("../services/permission.service");
const { serializeBigInt } = require("../utils/serializer");

class HouseController {
    
    // Create a new house
    async createHouse(req, res) {
        try {
            const { 
                ownerId, 
                address, 
                flatCount = 1,
                metadata = {},
                active = true // Default true for web_owner, false for others
            } = req.body;

            // Validate required fields
            if (!ownerId || !address) {
                return res.status(400).json({
                    success: false,
                    error: 'Owner ID and address are required'
                });
            }

            const currentUser = req.user;
            let hasPermission = false;
            let canSetActive = false;

            // Check if owner exists and is a house_owner
            const owner = await db('user as u')
                .where('u.id', ownerId)
                .leftJoin('role as r', 'u.roleId', 'r.id')
                .where('r.slug', 'house_owner')
                .select(
                    'u.*',
                    'r.slug as role_slug',
                    'r.id as role_id'
                )
                .first();

            if (!owner) {
                return res.status(400).json({
                    success: false,
                    error: 'Owner not found or not a house owner'
                });
            }

            // Get owner's current house count
            const [houseCountResult] = await db('house')
                .where('ownerId', ownerId)
                .count('* as count');
            
            const currentHouseCount = parseInt(houseCountResult.count);

            // Check permissions based on user role
            if (currentUser.role.slug === 'web_owner') {
                // Web owner can create houses for any house owner
                hasPermission = true;
                canSetActive = true;
            } 
            else if (currentUser.role.slug === 'staff') {
                // Staff needs houses.create permission
                hasPermission = await PermissionService.hasPermission(
                    currentUser.id, 
                    'houses.create'
                );
                
                // Check if staff can create for this specific owner
                if (hasPermission && currentUser.id !== parseInt(ownerId)) {
                    // Staff can only create for owners under their management
                    const isManaged = await this.checkUserHierarchy(currentUser.id, ownerId);
                    if (!isManaged) {
                        return res.status(403).json({
                            success: false,
                            error: 'You can only create houses for owners under your management'
                        });
                    }
                }
                canSetActive = false; // Staff creates inactive houses
            }
            else if (currentUser.role.slug === 'house_owner') {
                // House owner can only create for themselves
                if (currentUser.id !== parseInt(ownerId)) {
                    return res.status(403).json({
                        success: false,
                        error: 'You can only create houses for yourself'
                    });
                }
                
                // Check if house owner has houses.create permission
                hasPermission = await PermissionService.hasPermission(
                    currentUser.id, 
                    'houses.create'
                );
                canSetActive = false; // House owner creates inactive houses
            }
            else {
                return res.status(403).json({
                    success: false,
                    error: 'You do not have permission to create houses'
                });
            }

            if (!hasPermission) {
                return res.status(403).json({
                    success: false,
                    error: 'Insufficient permissions to create houses'
                });
            }


            const maxHouses = 5;

            if (currentHouseCount >= maxHouses) {
                return res.status(400).json({
                    success: false,
                    error: `House owner has reached the maximum limit of ${maxHouses} houses`
                });
            }

            // Set active status based on role
            const houseActive = canSetActive ? (active === true) : false;

            // Create the house
            const houseData = {
                uuid: uuid(),
                ownerId: ownerId,
                address,
                flatCount: flatCount,
                active: houseActive ? 1 : 0,
                createdAt: new Date(),
                metadata: JSON.stringify({
                    ...metadata,
                    createdByUserId: currentUser.id,
                    createdByRole: currentUser.role.slug,
                    createdAt: new Date().toISOString(),
                    initialActiveStatus: houseActive
                })
            };

            const [houseId] = await db('house').insert(houseData);

            const house = await db('house as h')
                .where('h.id', houseId)
                .leftJoin('user as u', 'h.ownerId', 'u.id')
                .select(
                    'h.*',
                    'u.id as owner_id',
                    'u.name as owner_name',
                    'u.email as owner_email',
                    'u.phone as owner_phone'
                )
                .first();

            // Parse metadata for response
            house.metadata = JSON.parse(house.metadata || '{}');
            house.active = Boolean(house.active);

            // Update owner's metadata with house count
            const ownerMetadata = owner.metadata ? JSON.parse(owner.metadata) : {};
            await db('user')
                .where('id', ownerId)
                .update({
                    metadata: JSON.stringify({
                        ...ownerMetadata,
                        totalHouses: currentHouseCount + 1,
                        lastHouseCreated: new Date().toISOString()
                    })
                });

            const responseHouse = {
                ...house,
                owner: {
                    id: house.owner_id,
                    name: house.owner_name,
                    email: house.owner_email,
                    phone: house.owner_phone
                }
            };

            // Remove joined fields
            delete responseHouse.owner_id;
            delete responseHouse.owner_name;
            delete responseHouse.owner_email;
            delete responseHouse.owner_phone;

            res.status(201).json({
                success: true,
                message: 'House created successfully',
                data: serializeBigInt(responseHouse)
            });
        } catch (error) {
            console.error('Create house error:', error);
            
            if (error.code === 'ER_DUP_ENTRY') {
                return res.status(400).json({
                    success: false,
                    error: 'House with this UUID already exists'
                });
            }

            res.status(500).json({ 
                success: false,
                error: 'Failed to create house' 
            });
        }
    }

        // Helper method to get flat details with renter
    async getFlatWithRenter(flatId) {
        const flat = await db('flat as f')
            .where('f.id', flatId)
            .leftJoin('renter as r', 'f.renterId', 'r.id')
            .select(
                'f.*',
                'r.id as renter_id',
                'r.name as renter_name',
                'r.phone as renter_phone',
                'r.email as renter_email',
                'r.status as renter_status'
            )
            .first();

        if (!flat) return null;

        const result = {
            id: flat.id,
            uuid: flat.uuid,
            houseId: flat.houseId,
            flatNumber: flat.number,
            name: flat.name,
            renterId: flat.renterId,
            metadata: flat.metadata ? JSON.parse(flat.metadata) : {},
            createdAt: flat.createdAt,
            updatedAt: flat.updatedAt,
            renter: null
        };

        if (flat.renterId) {
            result.renter = {
                id: flat.renter_id,
                name: flat.renter_name,
                phone: flat.renter_phone,
                email: flat.renter_email,
                status: flat.renter_status
            };
        }

        return result;
    }

    // Method to assign renter to flat
    async assignRenterToFlat(flatId, renterId) {
        return await db.transaction(async (trx) => {
            // Check if flat exists
            const flat = await trx('flat')
                .where('id', flatId)
                .first();

            if (!flat) {
                throw new Error('Flat not found');
            }

            // Check if renter exists
            const renter = await trx('renter')
                .where('id', renterId)
                .first();

            if (!renter) {
                throw new Error('Renter not found');
            }

            // Check if renter is already assigned to another flat
            const existingAssignment = await trx('flat')
                .where('renterId', renterId)
                .where('id', '!=', flatId)
                .first();

            if (existingAssignment) {
                throw new Error('Renter is already assigned to another flat');
            }

            // Update the flat with renterId
            await trx('flat')
                .where('id', flatId)
                .update({
                    renterId: renterId,
                    updatedAt: new Date()
                });

            // Update renter metadata or status if needed
            await trx('renter')
                .where('id', renterId)
                .update({
                    status: 'active',
                    updatedAt: new Date()
                });

            return this.getFlatWithRenter(flatId);
        });
    }

    // Method to remove renter from flat
    async removeRenterFromFlat(flatId) {
        return await db.transaction(async (trx) => {
            // Get flat with current renter
            const flat = await trx('flat')
                .where('id', flatId)
                .first();

            if (!flat) {
                throw new Error('Flat not found');
            }

            if (!flat.renterId) {
                throw new Error('Flat has no renter assigned');
            }

            // Update the flat to remove renterId
            await trx('flat')
                .where('id', flatId)
                .update({
                    renterId: null,
                    updatedAt: new Date()
                });

            // Update renter status to inactive or available
            await trx('renter')
                .where('id', flat.renterId)
                .update({
                    status: 'inactive',
                    updatedAt: new Date()
                });

            return this.getFlatWithRenter(flatId);
        });
    }

    // Update house with new permission checks
    async updateHouse(req, res) {
        try {
            const { id } = req.params;
            const { address, flatCount, metadata, active } = req.body;

            // Check if house exists
            const house = await db('house')
                .where('id', id)
                .first();

            if (!house) {
                return res.status(404).json({
                    success: false,
                    error: 'House not found'
                });
            }

            const currentUser = req.user;
            let canUpdate = false;
            let allowedFields = { address: false, flatCount: false, metadata: false, active: false };

            // Check permissions based on role
            if (currentUser.role.slug === 'web_owner') {
                canUpdate = true;
                allowedFields = { address: true, flatCount: true, metadata: true, active: true };
            } 
            else if (currentUser.role.slug === 'house_owner') {
                // House owner can only update their own houses
                if (house.ownerId !== currentUser.id) {
                    return res.status(403).json({
                        success: false,
                        error: 'You can only update your own houses'
                    });
                }
                
                // Check if house owner has houses.edit.own permission
                canUpdate = await PermissionService.hasPermission(
                    currentUser.id, 
                    'houses.edit.own'
                );
                allowedFields = { address: true, flatCount: true, metadata: true, active: false };
            }
            else if (currentUser.role.slug === 'staff') {
                // Staff has two ways to update:
                // 1. With house.update.any permission (can update any house, but only address)
                // 2. With houses.edit permission AND hierarchy check (can update full fields for managed houses)
                
                const hasUpdateAnyPermission = await PermissionService.hasPermission(
                    currentUser.id,
                    'house.update.any'
                );
                
                if (hasUpdateAnyPermission) {
                    canUpdate = true;
                    allowedFields = { address: true, flatCount: false, metadata: false, active: false };
                } else {
                    // Check regular houses.edit permission
                    canUpdate = await PermissionService.hasPermission(
                        currentUser.id,
                        'houses.edit'
                    );
                    
                    if (canUpdate) {
                        // Check if staff manages this house owner
                        const isManaged = await this.checkUserHierarchy(currentUser.id, house.ownerId);
                        if (!isManaged) {
                            return res.status(403).json({
                                success: false,
                                error: 'You can only update houses of owners under your management'
                            });
                        }
                        allowedFields = { address: true, flatCount: true, metadata: true, active: false };
                    }
                }
            } else {
                return res.status(403).json({
                    success: false,
                    error: 'You do not have permission to update houses'
                });
            }

            if (!canUpdate) {
                return res.status(403).json({
                    success: false,
                    error: 'Insufficient permissions to update this house'
                });
            }

            // Prepare update data based on allowed fields
            const updateData = {};
            const currentMetadata = house.metadata ? JSON.parse(house.metadata) : {};
            
            if (address !== undefined && allowedFields.address) {
                updateData.address = address;
            }
            if (flatCount !== undefined && allowedFields.flatCount) {
                updateData.flatCount = flatCount;
            }
            if (active !== undefined && allowedFields.active) {
                updateData.active = active ? 1 : 0;
            }
            
            if (metadata !== undefined && allowedFields.metadata) {
                updateData.metadata = JSON.stringify({
                    ...currentMetadata,
                    ...metadata,
                    updatedByUserId: currentUser.id,
                    updatedByRole: currentUser.role.slug,
                    updatedAt: new Date().toISOString()
                });
            } else if (Object.keys(updateData).length > 0) {
                // Still update metadata with update info even if metadata not changed
                updateData.metadata = JSON.stringify({
                    ...currentMetadata,
                    updatedByUserId: currentUser.id,
                    updatedByRole: currentUser.role.slug,
                    updatedAt: new Date().toISOString()
                });
            }

            // Check if there are fields to update
            if (Object.keys(updateData).length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'No valid fields to update or insufficient permissions for specified fields'
                });
            }

            updateData.updatedAt = new Date();

            await db('house')
                .where('id', id)
                .update(updateData);

            const updatedHouse = await db('house as h')
                .where('h.id', id)
                .leftJoin('user as u', 'h.ownerId', 'u.id')
                .select(
                    'h.*',
                    'u.id as owner_id',
                    'u.name as owner_name',
                    'u.email as owner_email'
                )
                .first();

            // Parse metadata
            updatedHouse.metadata = JSON.parse(updatedHouse.metadata || '{}');
            updatedHouse.active = Boolean(updatedHouse.active);

            const responseHouse = {
                ...updatedHouse,
                owner: {
                    id: updatedHouse.owner_id,
                    name: updatedHouse.owner_name,
                    email: updatedHouse.owner_email
                }
            };

            // Remove joined fields
            delete responseHouse.owner_id;
            delete responseHouse.owner_name;
            delete responseHouse.owner_email;

            res.json({
                success: true,
                message: 'House updated successfully',
                data: serializeBigInt(responseHouse)
            });
        } catch (error) {
            console.error('Update house error:', error);
            res.status(500).json({ 
                success: false,
                error: 'Failed to update house' 
            });
        }
    }

    // Delete house - only web_owner can delete
    async deleteHouse(req, res) {
        try {
            const { id } = req.params;

            // Check if house exists
            const house = await db('house')
                .where('id', id)
                .first();

            if (!house) {
                return res.status(404).json({
                    success: false,
                    error: 'House not found'
                });
            }

            // Only web_owner can delete houses
            if (req.user.role.slug !== 'web_owner') {
                return res.status(403).json({
                    success: false,
                    error: 'Only web owner can delete houses'
                });
            }

            // Check if house has flats
            const [flatCountResult] = await db('flat')
                .where('houseId', id)
                .count('* as count');

            if (parseInt(flatCountResult.count) > 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Cannot delete house that has flats. Delete flats first.'
                });
            }

            // Check if house has caretakers assigned
            const [caretakerCountResult] = await db('caretakerassignment')
                .where('houseId', id)
                .count('* as count');

            if (parseInt(caretakerCountResult.count) > 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Cannot delete house that has caretakers assigned. Remove caretakers first.'
                });
            }

            // Permanent delete
            await db('house')
                .where('id', id)
                .del();

            // Log the deletion in owner's metadata
            const owner = await db('user')
                .where('id', house.ownerId)
                .first();

            const ownerMetadata = owner.metadata ? JSON.parse(owner.metadata) : {};
            await db('user')
                .where('id', house.ownerId)
                .update({
                    metadata: JSON.stringify({
                        ...ownerMetadata,
                        housesDeleted: {
                            houseId: id,
                            deletedAt: new Date().toISOString(),
                            deletedBy: req.user.id
                        }
                    })
                });

            res.json({
                success: true,
                message: 'House deleted permanently',
                data: { id: id }
            });
        } catch (error) {
            console.error('Delete house error:', error);
            res.status(500).json({ 
                success: false,
                error: 'Failed to delete house' 
            });
        }
    }

    // Helper: Check user hierarchy (staff managing house owner)
    async checkUserHierarchy(parentId, childId) {
        const child = await db('user')
            .where('id', childId)
            .first();

        if (!child) return false;
        if (child.parentId === parentId) return true;
        if (!child.parentId) return false;

        return this.checkUserHierarchy(parentId, child.parentId);
    }

    // Helper: Get managed users
    async getManagedUsers(userId, roleFilter = null) {
        const user = await db('user as u')
            .where('u.id', userId)
            .leftJoin('role as r', 'u.roleId', 'r.id')
            .select('u.*', 'r.slug as role_slug')
            .first();

        if (!user) return [];

        let query = db('user as u')
            .leftJoin('role as r', 'u.roleId', 'r.id')
            .select('u.*', 'r.slug as role_slug', 'r.name as role_name');

        if (roleFilter) {
            query = query.where('r.slug', roleFilter);
        }

        const allUsers = await query;

        // Filter users who are under this user's management
        const managedUsers = [];
        for (const targetUser of allUsers) {
            const isManaged = await this.checkUserHierarchy(userId, targetUser.id);
            if (isManaged) {
                managedUsers.push(targetUser);
            }
        }

        return managedUsers;
    }

    // Get all houses with pagination and filters
    async getHouses(req, res) {
        try {
            const { 
                page = 1, 
                limit = 20, 
                ownerId, 
                search,
                sortBy = 'createdAt',
                sortOrder = 'desc'
            } = req.query;

            const pageNum = parseInt(page);
            const limitNum = parseInt(limit);
            const offset = (pageNum - 1) * limitNum;

            const currentUser = req.user;
            let query = db('house as h');

            // Apply filters based on user role
            if (currentUser.role.slug === 'house_owner') {
                // House owner can only see their own houses
                query = query.where('h.ownerId', currentUser.id);
            } 
            else if (currentUser.role.slug === 'staff') {
                // Staff can see houses of owners they manage
                const managedOwners = await this.getManagedUsers(currentUser.id, 'house_owner');
                const managedOwnerIds = managedOwners.map(owner => owner.id);
                
                if (managedOwnerIds.length > 0) {
                    query = query.whereIn('h.ownerId', managedOwnerIds);
                } else {
                    // If no managed owners, return empty
                    query = query.where('h.ownerId', null);
                }
            }
            // Web owner can see all houses (no filter)

            // Apply additional filters
            if (ownerId) {
                query = query.where('h.ownerId', ownerId);
            }

            if (search) {
                query = query.where(function() {
                    this.where('h.address', 'like', `%${search}%`)
                        .orWhere('h.uuid', 'like', `%${search}%`);
                });
            }

            // Get total count
            const [totalResult] = await query.clone().count('* as total');
            const total = parseInt(totalResult.total);

            // Get houses with owner details and counts
            const houses = await query
                .leftJoin('user as u', 'h.ownerId', 'u.id')
                .leftJoin('role as r', 'u.roleId', 'r.id')
                .select(
                    'h.*',
                    'u.id as owner_id',
                    'u.name as owner_name',
                    'u.email as owner_email',
                    'u.phone as owner_phone',
                    'r.slug as owner_role_slug'
                )
                .orderBy(`h.${sortBy}`, sortOrder)
                .limit(limitNum)
                .offset(offset);

            // Get counts for each house
            const houseIds = houses.map(h => h.id);
            
            const flatCounts = await db('flat')
                .whereIn('houseId', houseIds)
                .select('houseId')
                .count('* as count')
                .groupBy('houseId');

            const caretakerCounts = await db('caretakerassignment')
                .whereIn('houseId', houseIds)
                .select('houseId')
                .count('* as count')
                .groupBy('houseId');

            const noticeCounts = await db('notice')
                .whereIn('houseId', houseIds)
                .select('houseId')
                .count('* as count')
                .groupBy('houseId');

            const occupiedCounts = await db('flat')
            .whereIn('houseId', houseIds)
            .whereNotNull('renterId')
            .select('houseId')
            .count('* as count')
            .groupBy('houseId');

            // Create lookup objects
            const flatCountsMap = {};
            flatCounts.forEach(f => {
                flatCountsMap[f.houseId] = parseInt(f.count);
            });

            const caretakerCountsMap = {};
            caretakerCounts.forEach(c => {
                caretakerCountsMap[c.houseId] = parseInt(c.count);
            });

            const noticeCountsMap = {};
            noticeCounts.forEach(n => {
                noticeCountsMap[n.houseId] = parseInt(n.count);
            });

            const formattedHouses = houses.map(house => {
                const metadata = house.metadata ? JSON.parse(house.metadata) : {};
                return {
                    id: house.id,
                    uuid: house.uuid,
                    ownerId: house.ownerId,
                    address: house.address,
                    flatCount: house.flatCount,
                    active: Boolean(house.active),
                    metadata: metadata,
                    createdAt: house.createdAt,
                    updatedAt: house.updatedAt,
                    owner: {
                        id: house.owner_id,
                        name: house.owner_name,
                        email: house.owner_email,
                        phone: house.owner_phone,
                        role: {
                            slug: house.owner_role_slug
                        }
                    },
                    stats: {
                        flats: flatCountsMap[house.id] || 0,
                        caretakers: caretakerCountsMap[house.id] || 0,
                        notices: noticeCountsMap[house.id] || 0
                    }
                };
            });

            res.json({
                success: true,
                data: serializeBigInt(formattedHouses),
                pagination: {
                    total,
                    page: pageNum,
                    limit: limitNum,
                    pages: Math.ceil(total / limitNum)
                }
            });
        } catch (error) {
            console.error('Get houses error:', error);
            res.status(500).json({ 
                success: false,
                error: 'Failed to fetch houses' 
            });
        }
    }

    // Get single house details
    async getHouseDetails(req, res) {
    try {
        const { id } = req.params;

        const house = await db('house as h')
            .where('h.id', id)
            .leftJoin('user as u', 'h.ownerId', 'u.id')
            .leftJoin('role as r', 'u.roleId', 'r.id')
            .select(
                'h.*',
                'u.id as owner_id',
                'u.name as owner_name',
                'u.email as owner_email',
                'u.phone as owner_phone',
                'r.slug as owner_role_slug'
            )
            .first();

        if (!house) {
            return res.status(404).json({
                success: false,
                error: 'House not found'
            });
        }

        // Parse metadata
        house.metadata = house.metadata ? JSON.parse(house.metadata) : {};
        house.active = Boolean(house.active);

        // Check access permissions
        const hasAccess = await this.checkHouseAccess(req.user, house.id);
        if (!hasAccess) {
            return res.status(403).json({
                success: false,
                error: 'You do not have permission to view this house'
            });
        }

        // Get flats with renter (CORRECTED JOIN)
        const flats = await db('flat as f')
            .where('f.houseId', id)
            .leftJoin('renter as ren', 'f.renterId', 'ren.id')
            .select(
                'f.*',
                'ren.id as renter_id',
                'ren.name as renter_name',
                'ren.phone as renter_phone',
                'ren.status as renter_status',
                'ren.alternativePhone as renter_alternative_phone',
                'ren.email as renter_email',
                'ren.nid as renter_nid'
            );

        // Format flats - each flat has ONE renter (not array)
        const formattedFlats = flats.map(row => {
            const flat = {
                id: row.id,
                uuid: row.uuid,
                houseId: row.houseId,
                flatNumber: row.number, // Note: from schema, column is 'number' not 'flatNumber'
                name: row.name,
                metadata: row.metadata ? JSON.parse(row.metadata) : {},
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
                renter: null
            };

            // If there's a renterId, include renter details
            if (row.renterId) {
                flat.renter = {
                    id: row.renter_id,
                    name: row.renter_name,
                    phone: row.renter_phone,
                    alternativePhone: row.renter_alternative_phone,
                    email: row.renter_email,
                    nid: row.renter_nid,
                    status: row.renter_status
                };
            }

            return flat;
        });

        // Get caretakers with permissions
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

        // Get recent notices
        const notices = await db('notice')
            .where('houseId', id)
            .orderBy('createdAt', 'desc')
            .limit(5);

        const formattedHouse = {
            ...house,
            owner: {
                id: house.owner_id,
                name: house.owner_name,
                email: house.owner_email,
                phone: house.owner_phone,
                role: {
                    slug: house.owner_role_slug
                }
            },
            flats: formattedFlats,
            caretakers: groupedCaretakers,
            notices: notices.map(n => ({
                ...n,
                metadata: n.metadata ? JSON.parse(n.metadata) : {}
            }))
        };

        // Remove joined fields
        delete formattedHouse.owner_id;
        delete formattedHouse.owner_name;
        delete formattedHouse.owner_email;
        delete formattedHouse.owner_phone;
        delete formattedHouse.owner_role_slug;

        res.json({
            success: true,
            data: formattedHouse
        });
    } catch (error) {
        console.error('Get house details error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to fetch house details' 
        });
    }
}

    // Get house statistics
    async getHouseStats(req, res) {
        try {
            const currentUser = req.user;
            let houseQuery = db('house');

            if (currentUser.role.slug === 'house_owner') {
                houseQuery = houseQuery.where('ownerId', currentUser.id);
            } 
            else if (currentUser.role.slug === 'staff') {
                const managedOwners = await this.getManagedUsers(currentUser.id, 'house_owner');
                const managedOwnerIds = managedOwners.map(owner => owner.id);
                if (managedOwnerIds.length > 0) {
                    houseQuery = houseQuery.whereIn('ownerId', managedOwnerIds);
                } else {
                    houseQuery = houseQuery.where('ownerId', null);
                }
            }

            const [
                totalHousesResult,
                totalFlatsResult,
                totalCaretakersResult,
                recentHouses
            ] = await Promise.all([
                houseQuery.clone().count('* as count'),
                db('flat')
                    .whereIn('houseId', function() {
                        this.select('id').from('house').modify(function(qb) {
                            if (currentUser.role.slug === 'house_owner') {
                                qb.where('ownerId', currentUser.id);
                            } else if (currentUser.role.slug === 'staff') {
                                const managedOwners = this.getManagedUsers(currentUser.id, 'house_owner');
                                // Note: This won't work directly in the subquery
                                // We'll handle this differently
                            }
                        });
                    })
                    .count('* as count'),
                db('caretakerassignmentpermission')
                    .whereIn('houseId', function() {
                        this.select('id').from('house');
                    })
                    .count('* as count'),
                houseQuery.clone()
                    .leftJoin('user', 'house.ownerId', 'user.id')
                    .select(
                        'house.*',
                        'user.name as owner_name',
                        'user.email as owner_email'
                    )
                    .orderBy('house.createdAt', 'desc')
                    .limit(5)
            ]);

            const totalHouses = parseInt(totalHousesResult[0]?.count || 0);
            const totalFlats = parseInt(totalFlatsResult[0]?.count || 0);
            const totalCaretakers = parseInt(totalCaretakersResult[0]?.count || 0);

            // Get houses by month for chart (last 6 months)
            const sixMonthsAgo = new Date();
            sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

            const housesByMonth = await houseQuery.clone()
                .where('createdAt', '>=', sixMonthsAgo)
                .select(db.raw('DATE_FORMAT(createdAt, "%Y-%m") as month'))
                .count('* as count')
                .groupBy('month')
                .orderBy('month');

            res.json({
                success: true,
                data: {
                    totalHouses,
                    totalFlats,
                    totalCaretakers,
                    recentHouses: recentHouses.map(h => ({
                        ...h,
                        metadata: h.metadata ? JSON.parse(h.metadata) : {},
                        active: Boolean(h.active),
                        owner: {
                            name: h.owner_name,
                            email: h.owner_email
                        }
                    })),
                    housesByMonth: housesByMonth.map(item => ({
                        month: item.month,
                        count: parseInt(item.count)
                    }))
                }
            });
        } catch (error) {
            console.error('Get house stats error:', error);
            res.status(500).json({ 
                success: false,
                error: 'Failed to fetch house statistics' 
            });
        }
    }

    // Helper: Check house access
    async checkHouseAccess(user, houseId) {
        const house = await db('house')
            .where('id', houseId)
            .first();

        if (!house) return false;

        if (user.role.slug === 'web_owner') {
            return true;
        }

        if (user.role.slug === 'house_owner') {
            return house.ownerId === user.id;
        }

        if (user.role.slug === 'staff') {
            const isManaged = await this.checkUserHierarchy(user.id, house.ownerId);
            return isManaged;
        }

        return false;
    }

    // Helper: Get house details for permission check (without joins)
    async getHouseDetailsForPermission(houseId) {
        return await db('house')
            .where('id', houseId)
            .first();
    }
}

module.exports = new HouseController();