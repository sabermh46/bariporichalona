// controllers/caretaker.controller.js
const db = require("../config/knex");
const { v4: uuid } = require("uuid");
const { serializeBigInt } = require("../utils/serializer");
const PermissionService = require("../services/permission.service");

class CaretakerController {

  constructor() {
    this.getCaretakers = this.getCaretakers.bind(this);
    this.getCaretakerDetails = this.getCaretakerDetails.bind(this);
    this.updateAssignmentPermissions = this.updateAssignmentPermissions.bind(this);
    this.assignToHouse = this.assignToHouse.bind(this);
    this.removeFromHouse = this.removeFromHouse.bind(this);
    this.deleteCaretaker = this.deleteCaretaker.bind(this);
    this.getCaretakersForHouseOwner = this.getCaretakersForHouseOwner.bind(this);
    this.getAllCaretakerPermissions = this.getAllCaretakerPermissions.bind(this);
    this.canViewCaretaker = this.canViewCaretaker.bind(this);
    this.canModifyAssignment = this.canModifyAssignment.bind(this);
    this.canAssignCaretaker = this.canAssignCaretaker.bind(this);
    this.canRemoveAssignment = this.canRemoveAssignment.bind(this);
  }

  // Get all caretakers (with filters based on user role)
  async getCaretakers(req, res) {
    try {
      const {
        page = 1,
        limit = 20,
        search,
        houseId,
        houseOwnerId,
        sortBy = "createdAt",
        sortOrder = "desc",
      } = req.query;

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      const offset = (pageNum - 1) * limitNum;

      const currentUser = req.user;
      let query = db("user as u");

      // Join with role to filter only caretakers
      query = query
        .leftJoin("role as r", "u.roleId", "r.id")
        .where("r.slug", "caretaker");

      // Apply filters based on user role
      if (currentUser.role.slug === "house_owner") {
        // House owner can only see caretakers assigned to their houses
        const caretakerIds = await this.getCaretakersForHouseOwner(currentUser.id);
        if (caretakerIds.length === 0) {
          return res.json({
            success: true,
            data: [],
            pagination: {
              total: 0,
              page: pageNum,
              limit: limitNum,
              pages: 0,
            },
          });
        }
        query = query.whereIn("u.id", caretakerIds);
      } else if (currentUser.role.slug === "staff") {
        // Staff needs caretakers.view permission
        const hasPermission = await PermissionService.hasPermission(
          currentUser.id,
          "caretakers.view"
        );
        if (!hasPermission) {
          return res.status(403).json({
            success: false,
            error: "You do not have permission to view caretakers",
          });
        }
        // Staff can see all caretakers
      }
      // web_owner can see all caretakers (no filter)

      // Apply additional filters
      if (houseOwnerId) {
        // Get caretakers assigned to houses owned by this house owner
        const assignments = await db("caretakerassignment as ca")
          .join("house as h", "ca.houseId", "h.id")
          .where("h.ownerId", houseOwnerId)
          .select("ca.caretakerId");
        const caretakerIds = [...new Set(assignments.map(a => a.caretakerId))];
        if (caretakerIds.length > 0) {
          query = query.whereIn("u.id", caretakerIds);
        } else {
          query = query.where("u.id", 0); // No results
        }
      }

      if (houseId) {
        // Get caretakers assigned to this specific house
        const assignments = await db("caretakerassignment")
          .where("houseId", houseId)
          .select("caretakerId");
        const caretakerIds = assignments.map(a => a.caretakerId);
        if (caretakerIds.length > 0) {
          query = query.whereIn("u.id", caretakerIds);
        } else {
          query = query.where("u.id", 0); // No results
        }
      }

      if (search) {
        query = query.where(function () {
          this.where("u.name", "like", `%${search}%`)
            .orWhere("u.email", "like", `%${search}%`)
            .orWhere("u.phone", "like", `%${search}%`);
        });
      }

      // Get total count
      const [totalResult] = await query.clone().count("* as total");
      const total = parseInt(totalResult.total);

      // Get caretakers with basic info
      const caretakers = await query
        .select(
          "u.id",
          "u.uuid",
          "u.name",
          "u.email",
          "u.phone",
          "u.avatarUrl",
          "u.status",
          "u.createdAt",
          "u.parentId"
        )
        .orderBy(`u.${sortBy}`, sortOrder)
        .limit(limitNum)
        .offset(offset);

      // Get assignment counts and house owner info for each caretaker
      const caretakerIds = caretakers.map(c => c.id);
      
      const assignmentsData = await db("caretakerassignment as ca")
        .whereIn("ca.caretakerId", caretakerIds)
        .join("house as h", "ca.houseId", "h.id")
        .join("user as ho", "h.ownerId", "ho.id")
        .select(
          "ca.caretakerId",
          "ca.houseId",
          "h.name as houseName",
          "h.address as houseAddress",
          "ho.id as houseOwnerId",
          "ho.name as houseOwnerName",
          "ho.email as houseOwnerEmail"
        );

      // Group assignments by caretaker
      const assignmentsByCaretaker = {};
      assignmentsData.forEach(assignment => {
        if (!assignmentsByCaretaker[assignment.caretakerId]) {
          assignmentsByCaretaker[assignment.caretakerId] = [];
        }
        assignmentsByCaretaker[assignment.caretakerId].push({
          houseId: assignment.houseId,
          houseName: assignment.houseName,
          houseAddress: assignment.houseAddress,
          houseOwner: {
            id: assignment.houseOwnerId,
            name: assignment.houseOwnerName,
            email: assignment.houseOwnerEmail,
          },
        });
      });

      // Format response
      const formattedCaretakers = caretakers.map(caretaker => {
        const assignments = assignmentsByCaretaker[caretaker.id] || [];
        
        // Get unique house owners from assignments
        const houseOwners = [];
        const ownerIds = new Set();
        assignments.forEach(assignment => {
          if (!ownerIds.has(assignment.houseOwner.id)) {
            ownerIds.add(assignment.houseOwner.id);
            houseOwners.push(assignment.houseOwner);
          }
        });

        return {
          ...caretaker,
          assignmentCount: assignments.length,
          houseCount: new Set(assignments.map(a => a.houseId)).size,
          houseOwners: houseOwners,
          assignments: assignments.slice(0, 3), // Show only first 3 assignments
          hasMoreAssignments: assignments.length > 3,
        };
      });

      res.json({
        success: true,
        data: serializeBigInt(formattedCaretakers),
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(total / limitNum),
        },
      });
    } catch (error) {
      console.error("Get caretakers error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch caretakers",
      });
    }
  }

  // Get caretaker details with permissions
  async getCaretakerDetails(req, res) {
    try {
      const { id } = req.params;
      const currentUser = req.user;

      // Check if user can view this caretaker
      const canView = await this.canViewCaretaker(currentUser, id);
      if (!canView) {
        return res.status(403).json({
          success: false,
          error: "You do not have permission to view this caretaker",
        });
      }

      // Get caretaker basic info
      const caretaker = await db("user as u")
        .where("u.id", id)
        .leftJoin("role as r", "u.roleId", "r.id")
        .select(
          "u.*",
          "r.slug as role_slug",
          "r.name as role_name"
        )
        .first();

      if (!caretaker || caretaker.role_slug !== "caretaker") {
        return res.status(404).json({
          success: false,
          error: "Caretaker not found",
        });
      }

      // Get all active assignments with house and owner details
      const assignments = await db("caretakerassignment as ca")
        .where("ca.caretakerId", id)
        .andWhere(function() {
          this.where("ca.expiresAt", ">", new Date())
            .orWhereNull("ca.expiresAt");
        })
        .join("house as h", "ca.houseId", "h.id")
        .join("user as ho", "h.ownerId", "ho.id")
        .leftJoin("user as cb", "ca.createdBy", "cb.id")
        .select(
          "ca.id as assignmentId",
          "ca.uuid as assignmentUuid",
          "ca.houseId",
          "ca.createdBy",
          "ca.createdAt",
          "ca.expiresAt",
          "h.name as houseName",
          "h.address as houseAddress",
          "h.active as houseActive",
          "ho.id as houseOwnerId",
          "ho.name as houseOwnerName",
          "ho.email as houseOwnerEmail",
          "cb.name as createdByName",
          "cb.email as createdByEmail"
        );

      // Get all possible caretaker permissions
      const allPermissions = await this.getAllCaretakerPermissions();
      // Get permissions for each assignment
      const assignmentsWithPermissions = await Promise.all(
        assignments.map(async (assignment) => {
          const permissions = await db("caretakerassignmentpermission as cap")
            .where("cap.caretakerAssignmentId", assignment.assignmentId)
            .whereNull("cap.revokedAt")
            .join("permission as p", "cap.permissionId", "p.id")
            .select(
              "p.id",
              "p.key",
              "p.description",
              "cap.grantedAt",
              "cap.grantedBy"
            );

          // Add grantedBy user info
          const permissionsWithGrantor = await Promise.all(
            permissions.map(async (perm) => {
              const grantor = await db("user")
                .where("id", perm.grantedBy)
                .select("name", "email")
                .first();
              return {
                ...perm,
                grantedByUser: grantor,
              };
            })
          );

          // Format permissions with checked status
          const formattedPermissions = allPermissions?.all?.map(permission => {
            const assignedPermission = permissionsWithGrantor.find(
              p => p.key === permission.key
            );
            return {
              ...permission,
              assigned: !!assignedPermission,
              grantedAt: assignedPermission?.grantedAt,
              grantedBy: assignedPermission?.grantedByUser,
            };
          });

          return {
            ...assignment,
            permissions: formattedPermissions,
            houseActive: Boolean(assignment.houseActive),
            createdBy: {
              id: assignment.createdBy,
              name: assignment.createdByName,
              email: assignment.createdByEmail,
            },
            houseOwner: {
              id: assignment.houseOwnerId,
              name: assignment.houseOwnerName,
              email: assignment.houseOwnerEmail,
            },
            house: {
              id: assignment.houseId,
              name: assignment.houseName,
              address: assignment.houseAddress,
              active: Boolean(assignment.houseActive),
            },
          };
        })
      );

      // Get expired assignments count
      const expiredCount = await db("caretakerassignment")
        .where("caretakerId", id)
        .where("expiresAt", "<=", new Date())
        .count("* as count")
        .first();

      // Get total permissions count
      const totalPermissions = await db("caretakerassignmentpermission as cap")
        .join("caretakerassignment as ca", "cap.caretakerAssignmentId", "ca.id")
        .where("ca.caretakerId", id)
        .whereNull("cap.revokedAt")
        .count("* as count")
        .first();

      // Format response
      const formattedCaretaker = {
        id: caretaker.id,
        uuid: caretaker.uuid,
        name: caretaker.name,
        email: caretaker.email,
        phone: caretaker.phone,
        avatarUrl: caretaker.avatarUrl,
        status: caretaker.status,
        createdAt: caretaker.createdAt,
        updatedAt: caretaker.updatedAt,
        role: {
          slug: caretaker.role_slug,
          name: caretaker.role_name,
        },
        stats: {
          activeAssignments: assignments.length,
          expiredAssignments: parseInt(expiredCount?.count || 0),
          totalPermissions: parseInt(totalPermissions?.count || 0),
        },
        assignments: assignmentsWithPermissions,
      };

      res.json({
        success: true,
        data: serializeBigInt(formattedCaretaker),
      });
    } catch (error) {
      console.error("Get caretaker details error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch caretaker details",
      });
    }
  }

  // Update caretaker permissions for a specific assignment
  async updateAssignmentPermissions(req, res) {
    try {
        console.log(req.body);
        
      const { assignmentId } = req.params;
      const { permissions } = req.body; // Array of permission keys to assign
      const currentUser = req.user;

      // Get assignment details
      const assignment = await db("caretakerassignment as ca")
        .where("ca.id", assignmentId)
        .join("house as h", "ca.houseId", "h.id")
        .first();

      if (!assignment) {
        return res.status(404).json({
          success: false,
          error: "Assignment not found",
        });
      }

      // Check if user can modify permissions for this assignment
      const canModify = await this.canModifyAssignment(currentUser, assignment);
      if (!canModify) {
        return res.status(403).json({
          success: false,
          error: "You do not have permission to modify this assignment",
        });
      }

      // Get all possible caretaker permissions
      const allPermissions = await this.getAllCaretakerPermissions();
      const allPermissionKeys = allPermissions?.all?.map(p => p.key);

      // Validate that all provided permissions are valid for caretakers
      const invalidPermissions = permissions.filter(
        key => !allPermissionKeys.includes(key)
      );
      
      if (invalidPermissions.length > 0) {
        return res.status(400).json({
          success: false,
          error: `Invalid permissions: ${invalidPermissions.join(", ")}`,
        });
      }

      // Get current permissions for this assignment
      const currentPermissions = await db("caretakerassignmentpermission as cap")
        .where("cap.caretakerAssignmentId", assignmentId)
        .whereNull("cap.revokedAt")
        .join("permission as p", "cap.permissionId", "p.id")
        .select("p.key");

      const currentPermissionKeys = currentPermissions.map(p => p.key);

      // Determine permissions to add and revoke
      const permissionsToAdd = permissions.filter(
        key => !currentPermissionKeys.includes(key)
      );
      const permissionsToRevoke = currentPermissionKeys.filter(
        key => !permissions.includes(key)
      );

      // Get permission IDs
      const permissionRecords = await db("permission")
        .whereIn("key", [...permissionsToAdd, ...permissionsToRevoke])
        .select("id", "key");

      const permissionMap = {};
      permissionRecords.forEach(p => {
        permissionMap[p.key] = p.id;
      });

      // Perform updates in transaction
      await db.transaction(async (trx) => {
        // Add new permissions
        for (const permissionKey of permissionsToAdd) {
          const permission = await trx('permission')
            .where({ key: permissionKey })
            .first();
        
            if (permission) {
                // Check if permission already exists (even if revoked)
                const existingPermission = await trx('caretakerassignmentpermission')
                .where({
                    caretakerAssignmentId: assignmentId,
                    permissionId: permission.id
                })
                .first();
                
                if (existingPermission) {
                // Update existing record - reactivate the permission
                await trx('caretakerassignmentpermission')
                    .where({
                    caretakerAssignmentId: assignmentId,
                    permissionId: permission.id
                    })
                    .update({
                    revokedAt: null,
                    revokedBy: null,
                    grantedBy: currentUser.id,
                    grantedAt: new Date()
                    });
                } else {
                // Insert new record
                await trx('caretakerassignmentpermission').insert({
                    caretakerAssignmentId: assignmentId,
                    permissionId: permission.id,
                    grantedBy: currentUser.id,
                    grantedAt: new Date()
                });
                }
            }
        }

        // Revoke permissions
        for (const permissionKey of permissionsToRevoke) {
          await trx("caretakerassignmentpermission")
            .where("caretakerAssignmentId", assignmentId)
            .where("permissionId", permissionMap[permissionKey])
            .whereNull("revokedAt")
            .update({
              revokedAt: new Date(),
              revokedBy: currentUser.id,
            });
        }
      });

      res.json({
        success: true,
        message: "Permissions updated successfully",
        data: {
          added: permissionsToAdd.length,
          revoked: permissionsToRevoke.length,
        },
      });
    } catch (error) {
      console.error("Update permissions error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to update permissions",
      });
    }
  }

  // Assign caretaker to a house
  async assignToHouse(req, res) {
    try {
      const { caretakerId } = req.params;
      const { houseId, expiresAt, permissions } = req.body;
      const currentUser = req.user;

      // Check if user can assign caretakers
      const canAssign = await this.canAssignCaretaker(currentUser, houseId);
      if (!canAssign) {
        return res.status(403).json({
          success: false,
          error: "You do not have permission to assign caretakers",
        });
      }

      // Check if caretaker exists and is actually a caretaker
      const caretaker = await db("user as u")
        .where("u.id", caretakerId)
        .leftJoin("role as r", "u.roleId", "r.id")
        .where("r.slug", "caretaker")
        .first();

      if (!caretaker) {
        return res.status(404).json({
          success: false,
          error: "Caretaker not found",
        });
      }

      // Check if house exists
      const house = await db("house")
        .where("id", houseId)
        .first();

      if (!house) {
        return res.status(404).json({
          success: false,
          error: "House not found",
        });
      }

      // Check if assignment already exists and is active
      const existingAssignment = await db("caretakerassignment")
        .where({
          caretakerId,
          houseId,
        })
        .andWhere(function() {
          this.where("expiresAt", ">", new Date())
            .orWhereNull("expiresAt");
        })
        .first();

      if (existingAssignment) {
        return res.status(400).json({
          success: false,
          error: "Caretaker is already assigned to this house",
        });
      }

      // Create assignment
      const [assignmentId] = await db.transaction(async (trx) => {
        const [assignmentId] = await trx("caretakerassignment").insert({
          uuid: uuid(),
          houseId,
          caretakerId,
          createdBy: currentUser.id,
          createdAt: new Date(),
          expiresAt: expiresAt ? new Date(expiresAt) : null,
        });

        // Assign permissions if provided
        if (permissions && permissions.length > 0) {
          // Get permission IDs
          const permissionRecords = await trx("permission")
            .whereIn("key", permissions)
            .select("id", "key");

          const insertData = permissionRecords.map(permission => ({
            caretakerAssignmentId: assignmentId,
            permissionId: permission.id,
            grantedBy: currentUser.id,
            grantedAt: new Date(),
          }));

          if (insertData.length > 0) {
            await trx("caretakerassignmentpermission").insert(insertData);
          }
        }

        return assignmentId;
      });

      res.status(201).json({
        success: true,
        message: "Caretaker assigned successfully",
        data: { assignmentId },
      });
    } catch (error) {
      console.error("Assign caretaker error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to assign caretaker",
      });
    }
  }

  // Remove caretaker from a house
  async removeFromHouse(req, res) {
    try {
      const { assignmentId } = req.params;
      const currentUser = req.user;

      // Get assignment details
      const assignment = await db("caretakerassignment as ca")
        .where("ca.id", assignmentId)
        .join("house as h", "ca.houseId", "h.id")
        .first();

      if (!assignment) {
        return res.status(404).json({
          success: false,
          error: "Assignment not found",
        });
      }

      // Check if user can remove this assignment
      const canRemove = await this.canRemoveAssignment(currentUser, assignment);
      if (!canRemove) {
        return res.status(403).json({
          success: false,
          error: "You do not have permission to remove this assignment",
        });
      }

      // Soft delete by setting expiration to now
      await db("caretakerassignment")
        .where("id", assignmentId)
        .update({
          expiresAt: new Date(),
          updatedAt: new Date(),
        });

      // Revoke all permissions
      await db("caretakerassignmentpermission")
        .where("caretakerAssignmentId", assignmentId)
        .whereNull("revokedAt")
        .update({
          revokedAt: new Date(),
          revokedBy: currentUser.id,
        });

      res.json({
        success: true,
        message: "Caretaker removed from house successfully",
      });
    } catch (error) {
      console.error("Remove caretaker error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to remove caretaker",
      });
    }
  }

  // Delete caretaker (soft delete)
  async deleteCaretaker(req, res) {
    try {
      const { id } = req.params;
      const currentUser = req.user;

      // Check if user can delete caretakers
      if (!["web_owner", "staff"].includes(currentUser.role.slug)) {
        return res.status(403).json({
          success: false,
          error: "You do not have permission to delete caretakers",
        });
      }

      if (currentUser.role.slug === "staff") {
        const hasPermission = await PermissionService.hasPermission(
          currentUser.id,
          "caretakers.delete"
        );
        if (!hasPermission) {
          return res.status(403).json({
            success: false,
            error: "You do not have permission to delete caretakers",
          });
        }
      }

      // Check if caretaker exists
      const caretaker = await db("user as u")
        .where("u.id", id)
        .leftJoin("role as r", "u.roleId", "r.id")
        .where("r.slug", "caretaker")
        .first();

      if (!caretaker) {
        return res.status(404).json({
          success: false,
          error: "Caretaker not found",
        });
      }

      // Check if caretaker has active assignments
      const activeAssignments = await db("caretakerassignment")
        .where("caretakerId", id)
        .andWhere(function() {
          this.where("expiresAt", ">", new Date())
            .orWhereNull("expiresAt");
        })
        .count("* as count")
        .first();

      if (parseInt(activeAssignments.count) > 0) {
        return res.status(400).json({
          success: false,
          error: "Cannot delete caretaker with active assignments. Remove assignments first.",
        });
      }

      // Soft delete the user
      await db("user")
        .where("id", id)
        .update({
          status: "deleted",
          deletedAt: new Date(),
          updatedAt: new Date(),
        });

      res.json({
        success: true,
        message: "Caretaker deleted successfully",
      });
    } catch (error) {
      console.error("Delete caretaker error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to delete caretaker",
      });
    }
  }

  // Helper Methods

  async getCaretakersForHouseOwner(houseOwnerId) {
    const assignments = await db("caretakerassignment as ca")
      .join("house as h", "ca.houseId", "h.id")
      .where("h.ownerId", houseOwnerId)
      .andWhere(function() {
        this.where("ca.expiresAt", ">", new Date())
          .orWhereNull("ca.expiresAt");
      })
      .select("ca.caretakerId");

    return [...new Set(assignments.map(a => a.caretakerId))];
  }

  async getAllCaretakerPermissions() {
    const caretakerPermissions = [
      'houses.view.own',
      'houses.edit.own',
      'flats.create',
      'flats.view',
      'flats.edit',
      'flats.delete',
      'flats.assign',
      'renters.create',
      'renters.view',
      'renters.edit',
      'renters.delete',
      'notices.create.own',
      'notices.view',
      'notices.edit',
      'notices.delete',
      'notices.publish',
      'payments.create',
      'payments.view',
      'invoices.generate',
      'maintenance.create',
      'reports.view',
      'reports.generate',
      'reports.export',
      'analytics.view'
    ];

    const permissions = await db("permission")
      .whereIn("key", caretakerPermissions)
      .select("id", "key", "description")
      .orderBy("key");

    // Group by category for better organization
    const groupedPermissions = {
      houses: permissions.filter(p => p.key.startsWith('houses.')),
      flats: permissions.filter(p => p.key.startsWith('flats.')),
      renters: permissions.filter(p => p.key.startsWith('renters.')),
      notices: permissions.filter(p => p.key.startsWith('notices.')),
      payments: permissions.filter(p => p.key.startsWith('payments.')),
      invoices: permissions.filter(p => p.key.startsWith('invoices.')),
      maintenance: permissions.filter(p => p.key.startsWith('maintenance.')),
      reports: permissions.filter(p => p.key.startsWith('reports.')),
      analytics: permissions.filter(p => p.key.startsWith('analytics.')),
    };

    return {
      all: permissions,
      grouped: groupedPermissions,
    };
  }

  async canViewCaretaker(user, caretakerId) {
    if (user.role.slug === "web_owner") {
      return true;
    }

    if (user.role.slug === "house_owner") {
      // Check if caretaker is assigned to any of the house owner's houses
      const caretakers = await this.getCaretakersForHouseOwner(user.id);
      return caretakers.includes(parseInt(caretakerId));
    }

    if (user.role.slug === "staff") {
      const hasPermission = await PermissionService.hasPermission(
        user.id,
        "caretakers.view"
      );
      if (!hasPermission) return false;

      // Staff can view all caretakers (or optionally filter by managed owners)
      return true;
    }

    return false;
  }

  async canModifyAssignment(user, assignment) {
    if (user.role.slug === "web_owner") {
      return true;
    }

    if (user.role.slug === "house_owner") {
      // Check if this house belongs to the house owner
      const house = await db("house")
        .where("id", assignment.houseId)
        .where("ownerId", user.id)
        .first();
      return !!house;
    }

    if (user.role.slug === "staff") {
      const hasPermission = await PermissionService.hasPermission(
        user.id,
        "caretakers.assign"
      );
      if (!hasPermission) return false;

      // Check if staff manages this house owner
      const house = await db("house")
        .where("id", assignment.houseId)
        .first();
      
      if (!house) return false;

      const HouseController = require("./HouseController");
      return await HouseController.checkUserHierarchy(user.id, house.ownerId);
    }

    return false;
  }

  async canAssignCaretaker(user, houseId) {
    const house = await db("house")
      .where("id", houseId)
      .first();

    if (!house) return false;

    if (user.role.slug === "web_owner") {
      return true;
    }

    if (user.role.slug === "house_owner") {
      return house.ownerId === user.id;
    }

    if (user.role.slug === "staff") {
      const hasPermission = await PermissionService.hasPermission(
        user.id,
        "caretakers.assign"
      );
      if (!hasPermission) return false;

      const HouseController = require("./HouseController");
      return await HouseController.checkUserHierarchy(user.id, house.ownerId);
    }

    return false;
  }

  async canRemoveAssignment(user, assignment) {
    return await this.canModifyAssignment(user, assignment);
  }
}

module.exports = new CaretakerController();