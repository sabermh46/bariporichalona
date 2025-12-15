// controllers/house.controller.js
const { v4: uuid } = require("uuid");
const prisma = require("../config/prisma");
const permissionService = require("../services/permission.service");
const { serializeBigInt } = require("../utils/serializer")

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

            // Parse ownerId
            const parsedOwnerId = BigInt(ownerId);

            // Check if owner exists and is a house_owner
            const owner = await prisma.user.findUnique({
                where: { 
                    id: parsedOwnerId,
                    role: {
                        slug: 'house_owner'
                    }
                },
                include: {
                    role: true,
                    housesOwned: true
                }
            });

            if (!owner) {
                return res.status(400).json({
                    success: false,
                    error: 'Owner not found or not a house owner'
                });
            }

            // Check permissions based on user role
            const currentUser = req.user;
            let hasPermission = false;
            let canSetActive = false;

            if (currentUser.role.slug === 'web_owner') {
                // Web owner can create houses for any house owner
                hasPermission = true;
                canSetActive = true;
            } 
            else if (currentUser.role.slug === 'staff') {
                // Staff needs houses.create permission
                hasPermission = await permissionService.hasPermission(
                    currentUser.id, 
                    'houses.create'
                );
                
                // Check if staff can create for this specific owner
                if (hasPermission && currentUser.id !== parsedOwnerId) {
                    // Staff can only create for owners under their management
                    const isManaged = await this.checkUserHierarchy(currentUser.id, parsedOwnerId);
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
                if (currentUser.id !== parsedOwnerId) {
                    return res.status(403).json({
                        success: false,
                        error: 'You can only create houses for yourself'
                    });
                }
                
                // Check if house owner has houses.create permission
                hasPermission = await permissionService.hasPermission(
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

            // Check house limits for the owner
            const roleLimit = await prisma.roleLimit.findUnique({
                where: { roleSlug: owner.role.slug }
            });

            const maxHouses = roleLimit?.maxHouses || 1;
            const currentHouseCount = owner.housesOwned.length;

            if (currentHouseCount >= maxHouses) {
                return res.status(400).json({
                    success: false,
                    error: `House owner has reached the maximum limit of ${maxHouses} houses`
                });
            }

            // Set active status based on role
            const houseActive = canSetActive ? (active === true) : false;

            // Create the house
            const house = await prisma.house.create({
                data: {
                    uuid: uuid(),
                    ownerId: parsedOwnerId,
                    address,
                    flatCount: BigInt(flatCount),
                    active: houseActive,
                    createdAt: new Date().toISOString(),
                    metadata: {
                        ...metadata,
                        createdByUserId: currentUser.id,
                        createdByRole: currentUser.role.slug,
                        createdAt: new Date().toISOString(),
                        initialActiveStatus: houseActive
                    }
                },
                include: {
                    owner: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            phone: true
                        }
                    }
                }
            });

            // Update owner's metadata with house count
            await prisma.user.update({
                where: { id: parsedOwnerId },
                data: {
                    metadata: {
                        ...owner.metadata,
                        totalHouses: currentHouseCount + 1,
                        lastHouseCreated: new Date().toISOString()
                    }
                }
            });

            res.status(201).json({
                success: true,
                message: 'House created successfully',
                data: house
            });
        } catch (error) {
            console.error('Create house error:', error);
            
            if (error.code === 'P2002') {
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

    // Update house with new permission checks
    async updateHouse(req, res) {
        try {
            const { id } = req.params;
            const { address, flatCount, metadata, active } = req.body;

            // Check if house exists
            const house = await prisma.house.findUnique({
                where: { id: BigInt(id) }
            });

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
                canUpdate = await permissionService.hasPermission(
                    currentUser.id, 
                    'houses.edit.own'
                );
                allowedFields = { address: true, flatCount: true, metadata: true, active: false };
            }
            else if (currentUser.role.slug === 'staff') {
                // Staff has two ways to update:
                // 1. With house.update.any permission (can update any house, but only address)
                // 2. With houses.edit permission AND hierarchy check (can update full fields for managed houses)
                
                const hasUpdateAnyPermission = await permissionService.hasPermission(
                    currentUser.id,
                    'house.update.any'
                );
                
                if (hasUpdateAnyPermission) {
                    canUpdate = true;
                    allowedFields = { address: true, flatCount: false, metadata: false, active: false };
                } else {
                    // Check regular houses.edit permission
                    canUpdate = await permissionService.hasPermission(
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
            if (address !== undefined && allowedFields.address) {
                updateData.address = address;
            }
            if (flatCount !== undefined && allowedFields.flatCount) {
                updateData.flatCount = BigInt(flatCount);
            }
            if (active !== undefined && allowedFields.active) {
                updateData.active = active;
            }
            
            if (metadata !== undefined && allowedFields.metadata) {
                updateData.metadata = {
                    ...house.metadata,
                    ...metadata,
                    updatedByUserId: currentUser.id,
                    updatedByRole: currentUser.role.slug,
                    updatedAt: new Date().toISOString()
                };
            } else if (Object.keys(updateData).length > 0) {
                // Still update metadata with update info even if metadata not changed
                updateData.metadata = {
                    ...house.metadata,
                    updatedByUserId: currentUser.id,
                    updatedByRole: currentUser.role.slug,
                    updatedAt: new Date().toISOString()
                };
            }

            // Check if there are fields to update
            if (Object.keys(updateData).length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'No valid fields to update or insufficient permissions for specified fields'
                });
            }

            const updatedHouse = await prisma.house.update({
                where: { id: BigInt(id) },
                data: updateData,
                include: {
                    owner: {
                        select: {
                            id: true,
                            name: true,
                            email: true
                        }
                    }
                }
            });

            res.json({
                success: true,
                message: 'House updated successfully',
                data: updatedHouse
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
            const house = await prisma.house.findUnique({
                where: { id: BigInt(id) }
            });

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
            const flatCount = await prisma.flat.count({
                where: { houseId: BigInt(id) }
            });

            if (flatCount > 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Cannot delete house that has flats. Delete flats first.'
                });
            }

            // Check if house has caretakers assigned
            const caretakerCount = await prisma.caretakerAssignment.count({
                where: { houseId: BigInt(id) }
            });

            if (caretakerCount > 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Cannot delete house that has caretakers assigned. Remove caretakers first.'
                });
            }

            // Permanent delete (not soft delete since only web_owner can do this)
            await prisma.house.delete({
                where: { id: BigInt(id) }
            });

            // Log the deletion in owner's metadata
            await prisma.user.update({
                where: { id: house.ownerId },
                data: {
                    metadata: {
                        ...(await prisma.user.findUnique({
                            where: { id: house.ownerId }
                        })).metadata,
                        housesDeleted: {
                            houseId: id.toString(),
                            deletedAt: new Date().toISOString(),
                            deletedBy: req.user.id
                        }
                    }
                }
            });

            res.json({
                success: true,
                message: 'House deleted permanently',
                data: { id: id.toString() }
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
        const child = await prisma.user.findUnique({
            where: { id: childId },
            include: { parent: true }
        });

        if (!child) return false;
        if (child.parentId === parentId) return true;
        if (!child.parentId) return false;

        return this.checkUserHierarchy(parentId, child.parentId);
    }

    // Helper: Get managed users
    async getManagedUsers(userId, roleFilter = null) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: { role: true }
        });

        if (!user) return [];

        // Get all users where this user is in the parent hierarchy
        const allUsers = await prisma.user.findMany({
            where: {
                role: roleFilter ? { slug: roleFilter } : undefined
            },
            include: {
                role: true
            }
        });

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
            const skip = (pageNum - 1) * limitNum;

            const currentUser = req.user;
            const where = {};

            // Apply filters based on user role
            if (currentUser.role.slug === 'house_owner') {
                // House owner can only see their own houses
                where.ownerId = currentUser.id;
            } 
            else if (currentUser.role.slug === 'staff') {
                // Staff can see houses of owners they manage
                const managedOwners = await this.getManagedUsers(currentUser.id, 'house_owner');
                const managedOwnerIds = managedOwners.map(owner => owner.id);
                
                if (managedOwnerIds.length > 0) {
                    where.ownerId = { in: managedOwnerIds };
                } else {
                    // If no managed owners, return empty
                    where.ownerId = null;
                }
            }
            // Web owner can see all houses (no filter)

            // Apply additional filters
            if (ownerId) {
                where.ownerId = BigInt(ownerId);
            }

            if (search) {
                where.OR = [
                    { address: { contains: search, mode: 'insensitive' } },
                    { uuid: { contains: search, mode: 'insensitive' } }
                ];
            }

            // Get total count
            const total = await prisma.house.count({ where });

            // Get houses with owner details
            const houses = await prisma.house.findMany({
                where,
                include: {
                    owner: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            phone: true,
                            role: true
                        }
                    },
                    _count: {
                        select: {
                            flats: true,
                            caretakers: true,
                            notices: true
                        }
                    }
                },
                skip,
                take: limitNum,
                orderBy: { [sortBy]: sortOrder }
            });

            const formattedHouses = houses.map(house => ({
                ...house,
                stats: house._count,
                // Remove _count from response
                _count: undefined
            }));

            res.json({
                success: true,
                data: formattedHouses,
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

            const house = await prisma.house.findUnique({
                where: { id: BigInt(id) },
                include: {
                    owner: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            phone: true,
                            role: true
                        }
                    },
                    flats: {
                        include: {
                            renters: {
                                select: {
                                    id: true,
                                    name: true,
                                    phone: true,
                                    status: true
                                }
                            }
                        }
                    },
                    caretakers: {
                        include: {
                            caretaker: {
                                select: {
                                    id: true,
                                    name: true,
                                    email: true,
                                    phone: true
                                }
                            },
                            permissions: {
                                include: {
                                    permission: true
                                }
                            }
                        }
                    },
                    notices: {
                        take: 5,
                        orderBy: { createdAt: 'desc' }
                    }
                }
            });

            if (!house) {
                return res.status(404).json({
                    success: false,
                    error: 'House not found'
                });
            }

            // Check access permissions
            const hasAccess = await this.checkHouseAccess(req.user, house.id);
            if (!hasAccess) {
                return res.status(403).json({
                    success: false,
                    error: 'You do not have permission to view this house'
                });
            }

            res.json({
                success: true,
                data: house
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
            let where = {};

            if (currentUser.role.slug === 'house_owner') {
                where.ownerId = currentUser.id;
            } 
            else if (currentUser.role.slug === 'staff') {
                const managedOwners = await this.getManagedUsers(currentUser.id, 'house_owner');
                const managedOwnerIds = managedOwners.map(owner => owner.id);
                where.ownerId = { in: managedOwnerIds };
            }

            const [
                totalHouses,
                totalFlats,
                totalCaretakers,
                recentHouses
            ] = await Promise.all([
                prisma.house.count({ where }),
                prisma.flat.count({ 
                    where: {
                        house: where
                    }
                }),
                prisma.caretakerAssignment.count({
                    where: {
                        house: where
                    }
                }),
                prisma.house.findMany({
                    where,
                    take: 5,
                    orderBy: { createdAt: 'desc' },
                    include: {
                        owner: {
                            select: {
                                name: true,
                                email: true
                            }
                        }
                    }
                })
            ]);

            // Get houses by month for chart
            const sixMonthsAgo = new Date();
            sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

            const housesByMonth = await prisma.house.groupBy({
                by: ['createdAt'],
                where: {
                    ...where,
                    createdAt: { gte: sixMonthsAgo }
                },
                _count: true
            });

            res.json({
                success: true,
                data: {
                    totalHouses,
                    totalFlats,
                    totalCaretakers,
                    recentHouses,
                    housesByMonth: housesByMonth.map(item => ({
                        month: item.createdAt.toISOString().slice(0, 7),
                        count: item._count
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
}

module.exports = new HouseController();