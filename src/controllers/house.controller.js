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
                metadata = {} 
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

            if (currentUser.role.slug === 'web_owner') {
                // Web owner can create houses for any house owner
                hasPermission = true;
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

            // Create the house
            const house = await prisma.house.create({
                data: {
                    uuid: uuid(),
                    ownerId: parsedOwnerId,
                    address,
                    flatCount: BigInt(flatCount),
                    metadata: {
                        ...metadata,
                        createdByUserId: currentUser.id,
                        createdByRole: currentUser.role.slug,
                        createdAt: new Date().toISOString()
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

    // Update house
    async updateHouse(req, res) {
        try {
            const { id } = req.params;
            const { address, flatCount, metadata } = req.body;

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

            // Check update permissions
            const canUpdate = await this.checkHouseUpdatePermission(req.user, house);
            if (!canUpdate) {
                return res.status(403).json({
                    success: false,
                    error: 'You do not have permission to update this house'
                });
            }

            // Prepare update data
            const updateData = {};
            if (address !== undefined) updateData.address = address;
            if (flatCount !== undefined) updateData.flatCount = BigInt(flatCount);
            
            if (metadata !== undefined) {
                updateData.metadata = {
                    ...house.metadata,
                    ...metadata,
                    updatedByUserId: req.user.id,
                    updatedByRole: req.user.role.slug,
                    updatedAt: new Date().toISOString()
                };
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

    // Delete house (soft delete)
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

            // Check delete permissions
            const canDelete = await this.checkHouseDeletePermission(req.user, house);
            if (!canDelete) {
                return res.status(403).json({
                    success: false,
                    error: 'You do not have permission to delete this house'
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

            // Soft delete by updating metadata
            const deletedHouse = await prisma.house.update({
                where: { id: BigInt(id) },
                data: {
                    metadata: {
                        ...house.metadata,
                        deletedAt: new Date().toISOString(),
                        deletedByUserId: req.user.id,
                        deletedByRole: req.user.role.slug
                    }
                }
            });

            res.json({
                success: true,
                message: 'House deleted successfully',
                data: deletedHouse
            });
        } catch (error) {
            console.error('Delete house error:', error);
            res.status(500).json({ 
                success: false,
                error: 'Failed to delete house' 
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

    // Helper: Check if user can access house
    async checkHouseAccess(user, houseId) {
        if (['web_owner', 'developer'].includes(user.role.slug)) {
            return true;
        }

        const house = await prisma.house.findUnique({
            where: { id: BigInt(houseId) },
            select: { ownerId: true }
        });

        if (!house) return false;

        if (user.role.slug === 'house_owner') {
            return house.ownerId === user.id;
        }

        if (user.role.slug === 'staff') {
            const hasPermission = await permissionService.hasPermission(
                user.id, 
                'houses.view'
            );
            
            if (!hasPermission) return false;
            
            // Check if house owner is under staff's management
            return this.checkUserHierarchy(user.id, house.ownerId);
        }

        return false;
    }

    // Helper: Check if user can update house
    async checkHouseUpdatePermission(user, house) {
        if (['web_owner', 'developer'].includes(user.role.slug)) {
            return true;
        }

        if (user.role.slug === 'house_owner') {
            if (house.ownerId !== user.id) return false;
            
            const hasPermission = await permissionService.hasPermission(
                user.id, 
                'houses.edit.own'
            );
            return hasPermission;
        }

        if (user.role.slug === 'staff') {
            const hasPermission = await permissionService.hasPermission(
                user.id, 
                'houses.edit'
            );
            
            if (!hasPermission) return false;
            
            // Check if house owner is under staff's management
            return this.checkUserHierarchy(user.id, house.ownerId);
        }

        return false;
    }

    // Helper: Check if user can delete house
    async checkHouseDeletePermission(user, house) {
        if (['web_owner', 'developer'].includes(user.role.slug)) {
            return true;
        }

        if (user.role.slug === 'house_owner') {
            if (house.ownerId !== user.id) return false;
            
            const hasPermission = await permissionService.hasPermission(
                user.id, 
                'houses.delete'
            );
            return hasPermission;
        }

        if (user.role.slug === 'staff') {
            const hasPermission = await permissionService.hasPermission(
                user.id, 
                'houses.delete'
            );
            
            if (!hasPermission) return false;
            
            // Check if house owner is under staff's management
            return this.checkUserHierarchy(user.id, house.ownerId);
        }

        return false;
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
}

module.exports = new HouseController();