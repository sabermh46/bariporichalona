// controllers/renterController.js
const db = require('../config/knex');
const { v4: uuidv4 } = require('uuid');
const { 
    moveToPermanentLocation, 
    cleanupTempFiles, 
    getFileUrl, 
    uploadMultipleMiddleware
} = require('../utils/fileUpload');
const path = require('path');
const fs = require('fs');
const { hasPermission } = require('../services/permission.service');

class RenterController {

    constructor() {
        // Bind methods if necessary
        this.uploadFiles = this.uploadFiles.bind(this);
        this.createRenter = this.createRenter.bind(this);
        this.getRenters = this.getRenters.bind(this);
        this.getRenterDetails = this.getRenterDetails.bind(this);
        this.updateRenter = this.updateRenter.bind(this);
        this.deleteRenter = this.deleteRenter.bind(this);
        this.getAvailableRenters = this.getAvailableRenters.bind(this);
        this.checkRenterAccess = this.checkRenterAccess.bind(this);
        this.getAccessibleHouseOwners = this.getAccessibleHouseOwners.bind(this);
    }

    // Add this helper function at the top of the class
      _safeDeleteFile(fileUrl) {
        if (!fileUrl) return;
        try {
        // Remove the base URL to get relative path
        const relativePath = fileUrl.replace(/^\/uploads\//, '');
        const fullPath = path.join(process.cwd(), 'uploads', relativePath);
        
        // Security: Normalize paths and ensure we're within uploads directory
        const normalizedFullPath = path.normalize(fullPath);
        const normalizedUploadsDir = path.normalize(path.join(process.cwd(), 'uploads'));
        
        if (normalizedFullPath.startsWith(normalizedUploadsDir)) {
            if (fs.existsSync(normalizedFullPath)) {
            fs.unlinkSync(normalizedFullPath);
            }
        } else {
            console.warn('Security warning: Attempted to delete file outside uploads directory');
        }
        } catch (error) {
        console.error('Error deleting file:', error);
        // Don't throw - file cleanup failure shouldn't break the main operation
        }
    }

    // Fixed: Added upload middleware method
    uploadFiles() {
        return uploadMultipleMiddleware([
        { name: 'nidFrontImage', maxCount: 1 },
        { name: 'nidBackImage', maxCount: 1 }
        ]);
    }

    // 1. Create renter with file upload
    async createRenter(req, res) {
        let tempFiles = [];
        
        try {
            const { 
                name, 
                phone, 
                alternativePhone, 
                email, 
                nid,
                status = 'active',
                metadata,
                houseOwnerId // Required for staff/caretaker
            } = req.body;
            
            const userId = req.user.id;
            const userRole = req.user.role?.slug;
            
            // Validate required fields
            if (!name) {
                return res.status(400).json({
                    success: false,
                    error: 'Name is required'
                });
            }
            
            // Determine createdBy (house owner ID)
            let createdByUserId;
            let creatorInfo = {
                creatorUserId: userId,
                creatorName: req.user.name,
                creatorRole: userRole,
                creatorEmail: req.user.email
            };
            
            if (userRole === 'web_owner') {
                // Web owner can specify any house owner
                if (!houseOwnerId) {
                    return res.status(400).json({
                        success: false,
                        error: 'houseOwnerId is required for web owner'
                    });
                }
                createdByUserId = houseOwnerId;
                
                // Verify house owner exists
                const houseOwner = await db('user')
                    .where('id', houseOwnerId)
                    .andWhere('roleId', db('role').select('id').where('slug', 'house_owner'))
                    .first();
                
                if (!houseOwner) {
                    return res.status(400).json({
                        success: false,
                        error: 'Invalid house owner ID'
                    });
                }
            } 
            else if (userRole === 'house_owner') {
                // House owner creates renter for themselves
                createdByUserId = userId;
            }
            else if (userRole === 'staff') {
                // Staff needs permission and houseOwnerId
                const hasCreatePermission = await hasPermission(userId, 'renter.create');
                if (!hasCreatePermission) {
                    return res.status(403).json({
                        success: false,
                        error: 'You do not have permission to create renters'
                    });
                }
                
                if (!houseOwnerId) {
                    return res.status(400).json({
                        success: false,
                        error: 'houseOwnerId is required for staff'
                    });
                }
                
                createdByUserId = houseOwnerId;
                
                // Verify staff has access to this house owner
                // Staff can only create renters for house owners they work with
                const canAccessHouseOwner = await this.checkStaffAccess(userId, houseOwnerId);
                if (!canAccessHouseOwner) {
                    return res.status(403).json({
                        success: false,
                        error: 'You do not have access to this house owner'
                    });
                }
            }
            else {
                return res.status(403).json({
                    success: false,
                    error: 'You do not have permission to create renters'
                });
            }
            
            // Parse metadata if provided
            let finalMetadata = {
                ...creatorInfo,
                createdAt: new Date().toISOString()
            };
            
            if (metadata) {
                try {
                    const parsedMetadata = JSON.parse(metadata);
                    finalMetadata = { ...finalMetadata, ...parsedMetadata };
                } catch (e) {
                    console.error('Error parsing metadata:', e);
                }
            }
            
            // Start transaction
            const trx = await db.transaction();
            
            try {
                // Create renter record first (without image URLs)
                const renterData = {
                    uuid: uuidv4(),
                    name,
                    phone,
                    alternativePhone,
                    email,
                    nid,
                    status,
                    metadata: JSON.stringify(finalMetadata),
                    createdBy: createdByUserId,
                    createdAt: new Date(),
                    updatedAt: new Date()
                };
                
                const [renterId] = await trx('renter').insert(renterData);
                
                // Handle file uploads if any
                let nidFrontImageUrl = null;
                let nidBackImageUrl = null;
                
                // Process nidFrontImage
                if (req.files?.nidFrontImage) {
                    const file = req.files.nidFrontImage[0];
                    tempFiles.push(file.path);
                    
                    const permanentPath = moveToPermanentLocation(
                        file.path,
                        `renters/${renterId}`,
                        `nid_front${path.extname(file.originalname)}`
                    );
                    
                    nidFrontImageUrl = getFileUrl(permanentPath);
                }
                
                // Process nidBackImage
                if (req.files?.nidBackImage) {
                    const file = req.files.nidBackImage[0];
                    tempFiles.push(file.path);
                    
                    const permanentPath = moveToPermanentLocation(
                        file.path,
                        `renters/${renterId}`,
                        `nid_back${path.extname(file.originalname)}`
                    );
                    
                    nidBackImageUrl = getFileUrl(permanentPath);
                }
                
                // Update renter with image URLs if files were uploaded
                if (nidFrontImageUrl || nidBackImageUrl) {
                    await trx('renter')
                        .where('id', renterId)
                        .update({
                            nidFrontImageUrl,
                            nidBackImageUrl,
                            updatedAt: new Date()
                        });
                }
                
                // Get complete renter record
                const renter = await trx('renter')
                    .where('id', renterId)
                    .first();
                
                await trx.commit();
                
                // Clean up any remaining temp files
                cleanupTempFiles(tempFiles);
                
                return res.status(201).json({
                    success: true,
                    data: renter,
                    message: 'Renter created successfully'
                });
                
            } catch (error) {
                await trx.rollback();
                cleanupTempFiles(tempFiles);
                throw error;
            }
            
        } catch (error) {
            console.error('Create renter error:', error);
            cleanupTempFiles(tempFiles);
            return res.status(500).json({
                success: false,
                error: 'Failed to create renter: ' + error.message
            });
        }
    }
    
    // 2. Get renters with filters
    async getRenters(req, res) {
        try {
            const { 
                search, 
                status, 
                houseId,
                houseOwnerId,
                page = 1, 
                limit = 20 
            } = req.query;
            
            const userId = req.user.id;
            const userRole = req.user.role?.slug;
            const offset = (page - 1) * limit;
            
            // Start building query
            let query = db('renter')
                .select(
                    'renter.*',
                    'creator.name as creatorName',
                    'creator.email as creatorEmail'
                )
                .leftJoin('user as creator', 'renter.createdBy', 'creator.id');
            
            // Apply permission filters
            if (userRole === 'web_owner') {
                console.log("it is web owner");
            } 
            if(userRole === 'staff') {
                const hasPerm = await hasPermission(userId, 'renter.view');
                if (hasPerm) {
                    return res.status(403).json({
                        success: false,
                        error: 'You do not have permission to view renters',
                        data: [],
                        meta: {
                            page: parseInt(page),
                            limit: parseInt(limit),
                            total: 0,
                            totalPages: 0
                        }
                    })
                }
            }
            else if (userRole === 'house_owner') {
                // House owner can only see renters they created
                query.where('renter.createdBy', userId);
            }
            else if (userRole === 'caretaker') {
                // First, check if they have the global permission to view renters
                const hasViewPermission = await hasPermission(userId, 'renter.view');
                if (hasViewPermission) {
                    // Staff/Caretaker with global permission can see renters from houses they manage
                    const accessibleHouseOwners = await this.getAccessibleHouseOwners(userId);
                    if (accessibleHouseOwners.length > 0) {
                        query.whereIn('renter.createdBy', accessibleHouseOwners);
                    } else {
                        // No access to any house owner, return empty
                        query.where('1', '0');
                    }
                } else {
                    return res.status(403).json({
                        success: false,
                        error: 'You do not have permission to view renters'
                    });
                }
            }
            
            // Apply search filter
            if (search) {
                query.andWhere(function() {
                    this.where('renter.name', 'like', `%${search}%`)
                        .orWhere('renter.phone', 'like', `%${search}%`)
                        .orWhere('renter.email', 'like', `%${search}%`)
                        .orWhere('renter.nid', 'like', `%${search}%`);
                });
            }
            
            // Apply status filter
            if (status) {
                query.andWhere('renter.status', status);
            }
            
            // Filter by house owner (for web owner and staff with permission)
            if (houseOwnerId) {
                if (userRole === 'web_owner' || 
                    (userRole === 'staff' && await hasPermission(userId, 'renter.view_all'))) {
                    query.andWhere('renter.createdBy', houseOwnerId);
                }
            }
            
            // Filter by house (renters assigned to flats in a specific house)
            if (houseId) {
                query.whereExists(function() {
                    this.select('*')
                        .from('flat')
                        .whereRaw('flat.renter_id = renter.id')
                        .andWhere('flat.house_id', houseId);
                });
            }
            
            // Get total count
            const countQuery = query.clone().clearSelect().count('renter.id as count').first();
            const totalResult = await countQuery;
            const total = parseInt(totalResult.count);
            
            // Get paginated results
            const renters = await query
                .limit(limit)
                .offset(offset)
                .orderBy('renter.createdAt', 'desc');
            
            // For each renter, get associated flats
            const rentersWithFlats = await Promise.all(
                renters.map(async (renter) => {
                    const flats = await db('flat')
                        .join('house', 'flat.house_id', 'house.id')
                        .where('flat.renter_id', renter.id)
                        .select(
                            'flat.id',
                            'flat.number',
                            'flat.name as flatName',
                            'house.name as houseName',
                            'house.id as houseId'
                        );
                    
                    return {
                        ...renter,
                        flats,
                        flatCount: flats.length
                    };
                })
            );
            
            return res.json({
                success: true,
                data: rentersWithFlats,
                meta: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    totalPages: Math.ceil(total / limit)
                }
            });
            
        } catch (error) {
            console.error('Get renters error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch renters'
            });
        }
    }
    
    // 3. Get renter details
    async getRenterDetails(req, res) {
        try {
            const { id } = req.params;
            const userId = req.user.id;
            const userRole = req.user.role?.slug;
            console.log("hits here");
            
            
            // Get renter with creator info
            const renter = await db('renter')
                .select(
                    'renter.*',
                    'creator.name as creatorName',
                    'creator.email as creatorEmail',
                    'creator.phone as creatorPhone'
                )
                .leftJoin('user as creator', 'renter.createdBy', 'creator.id')
                .where('renter.id', id)
                .first();
            
            if (!renter) {
                return res.status(404).json({
                    success: false,
                    error: 'Renter not found'
                });
            }
            
            // Check access permission
            const hasAccess = await this.checkRenterAccess(userId, userRole, renter);
            if (!hasAccess) {
                return res.status(403).json({
                    success: false,
                    error: 'You do not have permission to view this renter'
                });
            }
            
            // Get associated flats
            const flats = await db('flat')
                .join('house', 'flat.house_id', 'house.id')
                .where('flat.renter_id', id)
                .select(
                    'flat.*',
                    'house.name as houseName',
                    'house.address as houseAddress'
                );
            
            // Get rent payment history
            const payments = await db('rent_payment')
                .where('renter_id', id)
                .orderBy('due_date', 'desc')
                .limit(12);
            
            // Parse metadata if it's a JSON string
            try {
                if (renter.metadata && typeof renter.metadata === 'string') {
                    renter.metadata = JSON.parse(renter.metadata);
                }
            } catch (e) {
                // Keep as is if not valid JSON
            }
            
            return res.json({
                success: true,
                data: {
                    renter,
                    flats,
                    payments,
                    statistics: {
                        totalFlats: flats.length,
                        totalPaid: payments.filter(p => p.status === 'paid').length,
                        totalPending: payments.filter(p => p.status === 'pending').length
                    }
                }
            });
            
        } catch (error) {
            console.error('Get renter details error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch renter details'
            });
        }
    }
    
    // 4. Update renter
    async updateRenter(req, res) {
        let tempFiles = [];
        
        try {
            const { id } = req.params;
            const updates = req.body;
            const userId = req.user.id;
            const userRole = req.user.role?.slug;
            
            // Get current renter
            const renter = await db('renter')
                .where('id', id)
                .first();
            
            if (!renter) {
                return res.status(404).json({
                    success: false,
                    error: 'Renter not found'
                });
            }
            
            // Check access permission
            const hasAccess = await this.checkRenterAccess(userId, userRole, renter);
            if (!hasAccess) {
                return res.status(403).json({
                    success: false,
                    error: 'You do not have permission to update this renter'
                });
            }
            
            // Start transaction
            const trx = await db.transaction();
            
            try {
                const updateData = {
                    ...updates,
                    updated_at: new Date()
                };
                
                delete updateData.id;
                delete updateData.uuid;
                delete updateData.createdBy;
                delete updateData.createdAt;
                // Handle metadata update
                if (updates.metadata) {
                    try {
                        const currentMetadata = renter.metadata ? JSON.parse(renter.metadata) : {};
                        const newMetadata = typeof updates.metadata === 'string' 
                            ? JSON.parse(updates.metadata) 
                            : updates.metadata;
                        
                        updateData.metadata = JSON.stringify({
                            ...currentMetadata,
                            ...newMetadata,
                            lastUpdatedBy: userId,
                            lastUpdatedAt: new Date().toISOString()
                        });
                    } catch (e) {
                        console.error('Error parsing metadata:', e);
                        // Keep existing metadata if parsing fails
                        delete updateData.metadata;
                    }
                }
                
                // Handle file uploads
                let nidFrontImageUrl = renter.nidFrontImageUrl;
                let nidBackImageUrl = renter.nidBackImageUrl;
                
                // Process nidFrontImage update
                if (req.files?.nidFrontImage) {
                    const file = req.files.nidFrontImage[0];
                    tempFiles.push(file.path);
                    
                    const permanentPath = moveToPermanentLocation(
                        file.path,
                        `renters/${id}`,
                        `nid_front${path.extname(file.originalname)}`
                    );
                    
                    nidFrontImageUrl = getFileUrl(permanentPath);
                    updateData.nidFrontImageUrl = nidFrontImageUrl;
                    
                    // Delete old file if exists
                    if (renter.nidFrontImageUrl && nidFrontImageUrl !== renter.nidFrontImageUrl) {
                        this._safeDeleteFile(renter.nidFrontImageUrl);
                    }
                }
                
                // Process nidBackImage update
                if (req.files?.nidBackImage) {
                    const file = req.files.nidBackImage[0];
                    tempFiles.push(file.path);
                    
                    const permanentPath = moveToPermanentLocation(
                        file.path,
                        `renters/${id}`,
                        `nid_back${path.extname(file.originalname)}`
                    );
                    
                    nidBackImageUrl = getFileUrl(permanentPath);
                    updateData.nidBackImageUrl = nidBackImageUrl;
                    

                    if (renter.nidBackImageUrl && nidBackImageUrl !== renter.nidBackImageUrl) {
                        this._safeDeleteFile(renter.nidBackImageUrl);
                    }
                }
                
                // Update renter
                await trx('renter')
                    .where('id', id)
                    .update(updateData);
                
                // Get updated renter
                const updatedRenter = await trx('renter')
                    .where('id', id)
                    .first();
                
                await trx.commit();
                
                // Clean up temp files
                cleanupTempFiles(tempFiles);
                
                return res.json({
                    success: true,
                    data: updatedRenter,
                    message: 'Renter updated successfully'
                });
                
            } catch (error) {
                await trx.rollback();
                cleanupTempFiles(tempFiles);
                throw error;
            }
            
        } catch (error) {
            console.error('Update renter error:', error);
            cleanupTempFiles(tempFiles);
            return res.status(500).json({
                success: false,
                error: 'Failed to update renter'
            });
        }
    }
    
    // 5. Delete renter (soft delete by changing status)
    async deleteRenter(req, res) {
        try {
            const { id } = req.params;
            const userId = req.user.id;
            const userRole = req.user.role?.slug;
            
            // Get renter
            const renter = await db('renter')
                .where('id', id)
                .first();
            
            if (!renter) {
                return res.status(404).json({
                    success: false,
                    error: 'Renter not found'
                });
            }
            
            // Check access permission
            const hasAccess = await this.checkRenterAccess(userId, userRole, renter);
            if (!hasAccess) {
                return res.status(403).json({
                    success: false,
                    error: 'You do not have permission to delete this renter'
                });
            }
            
            // Check if renter is assigned to any active flat
            const activeAssignment = await db('flat')
                .where('renter_id', id)
                .andWhere('renter_id', '!=', null)
                .first();
            
            if (activeAssignment) {
                return res.status(400).json({
                    success: false,
                    error: 'Cannot delete renter. Renter is currently assigned to a flat.'
                });
            }
            
            // Soft delete by changing status
            await db('renter')
                .where('id', id)
                .update({
                    status: 'deleted',
                    updated_at: new Date()
                });
            
            return res.json({
                success: true,
                message: 'Renter deleted successfully'
            });
            
        } catch (error) {
            console.error('Delete renter error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to delete renter'
            });
        }
    }
    
    // 6. Get available renters (not assigned to any flat)
    async getAvailableRenters(req, res) {
        try {
            const { houseId, search } = req.query;
            const userId = req.user.id;
            const userRole = req.user.role?.slug;
            
            // Start building query
            let query = db('renter')
                .where('renter.status', 'active')
                .whereNotExists(function() {
                    this.select('*')
                        .from('flat')
                        .whereRaw('flat.renter_id = renter.id')
                        .andWhere('flat.renter_id', '!=', null);
                });
            
            // Apply permission filters
            if (userRole === 'web_owner') {
                // Web owner can see all available renters
            } 
            else if (userRole === 'house_owner') {
                // House owner can only see renters they created
                query.where('renter.createdBy', userId);
            }
            else if (userRole === 'staff') {

            }
            else {
                return res.status(403).json({
                    success: false,
                    error: 'You do not have permission to view renters'
                });
            }
            
            // Filter by house owner (if houseId provided, get renters created by that house's owner)
            if (houseId) {
                const house = await db('house')
                    .where('id', houseId)
                    .select('ownerId')
                    .first();
                
                if (house) {
                    query.andWhere('renter.createdBy', house.ownerId);
                }
            }
            
            // Apply search filter
            if (search) {
                query.andWhere(function() {
                    this.where('renter.name', 'like', `%${search}%`)
                        .orWhere('renter.phone', 'like', `%${search}%`)
                        .orWhere('renter.email', 'like', `%${search}%`);
                });
            }
            
            const renters = await query
                .select('renter.*')
                .orderBy('renter.name', 'asc');
            
            return res.json({
                success: true,
                data: renters
            });
            
        } catch (error) {
            console.error('Get available renters error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch available renters'
            });
        }
    }
    
    // Helper method to check staff access to house owner
    async checkStaffAccess(staffId, houseOwnerId) {
        try {
            // Staff can access house owner if they are assigned to any of their houses
            const assignment = await db('caretakerassignment')
                .join('house', 'caretakerassignment.houseId', 'house.id')
                .where('caretakerassignment.caretakerId', staffId)
                .andWhere('house.ownerId', houseOwnerId)
                .andWhere('caretakerassignment.expiresAt', '>', new Date())
                .first();
            
            return !!assignment;
        } catch (error) {
            return false;
        }
    }
    
    // Helper method to get accessible house owners for staff
    async getAccessibleHouseOwners(staffId) {
        try {
            const assignments = await db('caretakerassignment')
                .join('house', 'caretakerassignment.houseId', 'house.id')
                .where('caretakerassignment.caretakerId', staffId)
                .andWhere('caretakerassignment.expiresAt', '>', new Date())
                .distinct('house.ownerId')
                .pluck('house.ownerId');
            
            return assignments;
        } catch (error) {
            return [];
        }
    }
    
    // Helper method to check renter access
    async checkRenterAccess(userId, userRole, renter) {
        if (userRole === 'web_owner') {
            return true;
        }
        
        if (userRole === 'house_owner') {
            return renter.createdBy === userId;
        }
        
        if (userRole === 'staff') {
            // Check if staff has access to the house owner who created this renter
            const hasPerm = await hasPermission(userId, 'renter.view');
            if (!hasPerm) {
                return false;
            }
            return hasPerm;
        }
        
        return false;
    }
}

module.exports = new RenterController();