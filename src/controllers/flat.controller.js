// flat.controller.js - Updated with consistent column naming
const db = require("../config/knex");
const { v4: uuidv4 } = require("uuid");
const { hasPermission } = require("../services/permission.service");
const { getAccessibleHouseOwners } = require("./common/index");
const CaretakerPermissionService = require("../services/CaretakerPermission.service");
const notify = require("../services/inAppNotification.service");
const { parsePagination } = require("../utils/pagination");

class FlatController {
  constructor() {
    this.updateFlat = this.updateFlat.bind(this);
    this.deleteFlat = this.deleteFlat.bind(this);
    this.assignRenter = this.assignRenter.bind(this);
    this.removeRenter = this.removeRenter.bind(this);
    this.checkFlatAccess = this.checkFlatAccess.bind(this);
    this.getFlatDetails = this.getFlatDetails.bind(this);
    this.applyAdvancePayment = this.applyAdvancePayment.bind(this);
    this.getFlatAdvancePayments = this.getFlatAdvancePayments.bind(this);
    this.createAdvancePayment = this.createAdvancePayment.bind(this);
    this.updateAdvancePayment = this.updateAdvancePayment.bind(this);
    this.deleteAdvancePayment = this.deleteAdvancePayment.bind(this);
  }
  // 1. Create flat (with flatCount limit check)
  async createFlat(req, res) {
    try {
      const {
        number,
        name,
        rent_amount,
        should_pay_rent_day,
        late_fee_percentage,
        metadata,
      } = req.body;
      const userId = req.user.id;
      const { houseId } = req.params; // From URL params

      let metadataToStore = null;
      if (metadata) {
        if (typeof metadata === "string") {
          try {
            JSON.parse(metadata);
            metadataToStore = metadata;
          } catch (error) {
            metadataToStore = JSON.stringify({
              notes: metadata,
              createdBy: userId,
              createdAt: new Date().toISOString(),
            });
          }
        } else if (typeof metadata === "object") {
          // Already an object, stringify it
          metadataToStore = JSON.stringify({
            ...metadata,
            createdBy: req.user.id,
            createdAt: new Date().toISOString(),
          });
        }
      }

      // For web_owner, allow without further checks
      if (req.user.role.slug === "web_owner") {
        // Web owner can create flats in any house
        const house = await db("house")
          .where("id", houseId)
          .andWhere("active", true)
          .select("*")
          .first();

        if (!house) {
          return res.status(404).json({
            success: false,
            error: "House not found or not active",
          });
        }

        // Check flat count limit
        const currentFlatCount = await db("flat")
          .where("house_id", houseId)
          .count("id as count")
          .first();

        if (parseInt(currentFlatCount.count) >= parseInt(house.flatCount)) {
          return res.status(400).json({
            success: false,
            error: `Maximum flat limit (${house.flatCount}) reached for this house`,
          });
        }

        // Check if flat number already exists in the house
        if (number) {
          const existingFlat = await db("flat")
            .where("house_id", houseId)
            .andWhere("number", number)
            .first();

          if (existingFlat) {
            return res.status(400).json({
              success: false,
              error: "Flat number already exists in this house",
            });
          }
        }

        // Create flat
        const flatData = {
          uuid: uuidv4(),
          house_id: houseId,
          number,
          name,
          rent_amount,
          metadata: metadataToStore,
          late_fee_percentage,
          should_pay_rent_day: should_pay_rent_day ?? 10,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const [flatId] = await db("flat").insert(flatData);

        // Update house flat count
        await db("house").where("id", houseId).increment("flatCount", 1);

        return res.status(201).json({
          success: true,
          data: {
            id: flatId,
            ...flatData,
          },
        });
      }

      // For house_owner and staff, check permissions
      let hasAccess = false;
      let house = null;

      // First, check if user is the house owner
      house = await db("house")
        .where("id", houseId)
        .andWhere("ownerId", userId)
        .andWhere("active", true)
        .select("*")
        .first();

      if (house) {
        hasAccess = true;
      }

      // If not owner, check if user is a staff with caretaker assignment
      if (!hasAccess) {
        // Check if user has the permission 'flat.create'
        const hasFlatCreatePermission = await hasPermission(
          "flat.create",
          userId
        );

        if (hasFlatCreatePermission) {
          // Check if user is assigned as caretaker to this house
          const caretakerAssignment = await db("caretakerassignment")
            .where("houseId", houseId)
            .andWhere("caretakerId", userId)
            .andWhere("expiresAt", ">", new Date())
            .first();

          if (caretakerAssignment) {
            // Get house details
            house = await db("house")
              .where("id", houseId)
              .andWhere("active", true)
              .select("*")
              .first();

            if (house) {
              hasAccess = true;
            }
          }
        }
      }

      if (!hasAccess || !house) {
        return res.status(403).json({
          success: false,
          error: "You do not have permission to create flats in this house",
        });
      }

      // Check flat count limit
      const currentFlatCount = await db("flat")
        .where("house_id", houseId)
        .count("id as count")
        .first();


      if (parseInt(currentFlatCount.count) >= parseInt(house.flatCount)) {
        return res.status(400).json({
          success: false,
          error: `Maximum flat limit (${house.flatCount}) reached for this house`,
        });
      }

      // Check if flat number already exists in the house
      if (number) {
        const existingFlat = await db("flat")
          .where("house_id", houseId)
          .andWhere("number", number)
          .first();

        if (existingFlat) {
          return res.status(400).json({
            success: false,
            error: "Flat number already exists in this house",
          });
        }
      }

      // Create flat
      const flatData = {
        uuid: uuidv4(),
        house_id: houseId,
        number,
        name,
        late_fee_percentage,
        metadata: metadataToStore,
        rent_amount,
        should_pay_rent_day: should_pay_rent_day ?? 10,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const [flatId] = await db("flat").insert(flatData);

      // Update house flat count
      //   await db("house").where("id", houseId).increment("flatCount", 1);

      return res.status(201).json({
        success: true,
        data: {
          id: flatId,
          ...flatData,
        },
      });
    } catch (error) {
      console.error("Create flat error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to create flat",
      });
    }
  }

  

  // 2. Get flats with filters (vacant/occupied, houseId)
  async getFlats(req, res) {
    try {
      const { houseId: house_id } = req.params;
      const { status, search, page: rawPage = 1, limit: rawLimit = 20 } = req.query;
      const userId = req.user.id;
      const { page, limit, offset } = parsePagination(rawPage, rawLimit, 20);

      if (req.user.role.slug === "caretaker") {
        // Check if caretaker has access to the specified house
        const availableHouseOwner = await getAccessibleHouseOwners(userId);
        if (availableHouseOwner.length === 0) {
          return res.status(403).json({
            success: false,
            error: "No accessible houses found for this caretaker",
          });
        } else {
          const houseOwnerId = availableHouseOwner[0];
          //get all houses for this owner
          const houses = await db("house")
            .where("ownerId", houseOwnerId)
            .andWhere("active", true)
            .select("id");
            console.log('houses: ' , houses);

          const houseIds = houses.map((h) => h.id);
          if (house_id && !houseIds.includes(parseInt(house_id))) {
            return res.status(403).json({
              success: false,
              error: "You do not have access to this house",
            });
          }
            
        }
      }

      // Build base query
      let query = db("flat")
        .leftJoin("house", "flat.house_id", "house.id")
        .leftJoin("renter", "flat.renter_id", "renter.id")
        .leftJoin("user", "house.ownerId", "user.id")
        .select(
          "flat.*",
          "house.name as houseName",
          "house.address as houseAddress",
          "renter.name as renterName",
          "renter.phone as renterPhone",
          "renter.email as renterEmail",
          "user.name as ownerName"
        );

      // Apply permission filter - owner or caretaker
      if (req.user.role.slug === "staff" || req.user.role.slug === "house_owner") {
        query.where(function () {
          this.where("house.ownerId", userId).orWhereExists(function () {
            this.select("*")
              .from("caretakerassignment")
              .whereRaw("caretakerassignment.houseId = house.id")
              .andWhere("caretakerassignment.caretakerId", userId)
              .andWhere("caretakerassignment.expiresAt", ">", new Date());
          });
        });
      }

      // Apply filters
      if (house_id) {
        query.andWhere("flat.house_id", house_id);
      }

      if (status === "vacant") {
        query.andWhere("flat.renter_id", null);
      } else if (status === "occupied") {
        query.andWhere("flat.renter_id", "!=", null);
      }

      if (search) {
        query.andWhere(function () {
          this.where("flat.name", "like", `%${search}%`)
            .orWhere("flat.number", "like", `%${search}%`)
            .orWhere("renter.name", "like", `%${search}%`);
        });
      }

      // Get total count
      const countQuery = query
        .clone()
        .clearSelect()
        .count("flat.id as count")
        .first();
      const totalResult = await countQuery;
      const total = parseInt(totalResult.count);

      // Get paginated results
      query.limit(limit).offset(offset).orderBy("flat.createdAt", "desc");
      const flats = await query;

      // Calculate occupancy statistics
      const stats = await db("flat")
        .where("house_id", house_id || db.raw("flat.house_id"))
        .select(
          db.raw("COUNT(*) as total"),
          db.raw(
            "SUM(CASE WHEN renter_id IS NULL THEN 1 ELSE 0 END) as vacant"
          ),
          db.raw(
            "SUM(CASE WHEN renter_id IS NOT NULL THEN 1 ELSE 0 END) as occupied"
          )
        )
        .first();

      return res.json({
        success: true,
        data: flats,
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          stats,
        },
      });
    } catch (error) {
      console.error("Get flats error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch flats",
      });
    }
  }

  // 3. Get flat details with payment history
  async getFlatDetails(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      // Get flat with permission check
      const flat = await db("flat")
        .leftJoin("house", "flat.house_id", "house.id")
        .leftJoin("renter", "flat.renter_id", "renter.id")
        .leftJoin("user as owner", "house.ownerId", "owner.id")
        .where("flat.id", id)
        .select(
          "flat.*",
          "house.name as houseName",
          "house.address as houseAddress",
          "house.ownerId",
          "owner.email as ownerEmail",
          "owner.phone as ownerPhone",
          "renter.name as renterName",
          "renter.phone as renterPhone",
          "renter.email as renterEmail",
          "renter.id as renterId"
        )
        .first();

      if (!flat) {
        return res.status(404).json({
          success: false,
          error: "Flat not found",
        });
      }
      

      // Check permission
      if (req.user.role.slug === "caretaker") {
        // Check if caretaker has access to the specified house
        const hasPerm = await CaretakerPermissionService.hasCaretakerPermission(userId, flat?.house_id, 'flats.view');
          

          if (!hasPerm) {
            return res.status(403).json({
              success: false,
              error: "You do not have access to this flat",
            });

          }
      }

      // Get payment history
      const payments = await db("rent_payment")
        .where("flat_id", id)
        .orderBy("due_date", "desc")
        .limit(12);

      // Calculate statistics
      const stats = await db("rent_payment")
        .where("flat_id", id)
        .select(
          db.raw("SUM(amount) as totalDue"),
          db.raw("SUM(paid_amount) as totalPaid"),
          db.raw("SUM(late_fee_amount) as totalLateFees"),
          db.raw(
            'COUNT(CASE WHEN status = "pending" THEN 1 END) as pendingCount'
          ),
          db.raw(
            'COUNT(CASE WHEN status = "overdue" THEN 1 END) as overdueCount'
          )
        )
        .first();

      return res.json({
        success: true,
        data: {
          flat,
          payments,
          stats,
        },
      });
    } catch (error) {
      console.error("Get flat details error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch flat details",
      });
    }
  }

  // 4. Update flat (rent amount, should_pay_rent_day)
  async updateFlat(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const updates = req.body;

      // If metadata is being updated
      if (updates.metadata) {
        if (typeof updates.metadata === "string") {
          try {
            // Try to parse if it's JSON
            JSON.parse(updates.metadata);
            // If it's valid JSON, keep it as is
          } catch (e) {
            // If it's plain text, wrap it
            updates.metadata = JSON.stringify({
              notes: updates.metadata,
              updatedBy: userId,
              updatedAt: new Date().toISOString(),
            });
          }
        } else if (typeof updates.metadata === "object") {
          updates.metadata = JSON.stringify(updates.metadata);
        }
      }

      updates.updatedAt = new Date();

      // Get flat with house info
      const flat = await db("flat")
        .join("house", "flat.house_id", "house.id")
        .where("flat.id", id)
        .select("flat.*", "house.ownerId")
        .first();

      if (!flat) {
        return res.status(404).json({
          success: false,
          error: "Flat not found",
        });
      }

      // Check permission
      const role = req.user.role.slug;
      if (role !== "web_owner") {
        if (role === "staff") {
          const hasPerm = await hasPermission(userId, "flats.edit");
          if (!hasPerm) {
            return res.status(403).json({ success: false, error: "Permission denied||অনুমতি নেই" });
          }
        } else {
          const hasAccess = await this.checkFlatAccess(userId, flat.house_id);
          if (!hasAccess) {
            return res.status(403).json({
              success: false,
              error: "You do not have permission to update this flat",
            });
          }
        }
      }

      // Prepare update data
      const updateData = {
        ...updates,
        updatedAt: new Date(),
      };

      // If rent_amount or should_pay_rent_day changes, recalculate due dates
      if (updates.rent_amount || updates.should_pay_rent_day) {
        if (flat.renter_id) {
          await this.recalculateRentDueDate(id, updates);
        }
      }

      // Update flat
      await db("flat").where("id", id).update(updateData);

      const updatedFlat = await db("flat").where("id", id).first();

      return res.json({
        success: true,
        data: updatedFlat,
      });
    } catch (error) {
      console.error("Update flat error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to update flat",
      });
    }
  }

    async deleteFlat(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      // Start a transaction to ensure data consistency
      const trx = await db.transaction();

      try {
        // Get flat with house info within transaction
        const flat = await trx("flat")
          .join("house", "flat.house_id", "house.id")
          .where("flat.id", id)
          .select("flat.*", "house.ownerId")
          .first();

        if (!flat) {
          await trx.rollback();
          return res.status(404).json({
            success: false,
            error: "Flat not found",
          });
        }

        // Check permission
        const role = req.user.role.slug;
        if (role !== "web_owner") {
          if (role === "staff") {
            const hasPerm = await hasPermission(userId, "flats.delete");
            if (!hasPerm) {
              await trx.rollback();
              return res.status(403).json({ success: false, error: "Permission denied||অনুমতি নেই" });
            }
          } else {
            const ownerId = flat.ownerId || flat.owner_id;
            if (ownerId !== userId) {
              await trx.rollback();
              return res.status(403).json({
                success: false,
                error: "Only the house owner can delete flats",
              });
            }
          }
        }

        // Check if flat has active renter
        if (flat.renter_id) {
          await trx.rollback();
          return res.status(400).json({
            success: false,
            error:
              "Cannot delete flat with active renter. Remove renter first.",
          });
        }

        // Check if there are pending payments
        const pendingPayments = await trx("rent_payment")
          .where("flat_id", id)
          .andWhere("status", "in", ["pending", "overdue"])
          .first();

        if (pendingPayments) {
          await trx.rollback();
          return res.status(400).json({
            success: false,
            error: "Cannot delete flat with pending payments",
          });
        }

        // First, delete all related rent_payment records
        await trx("rent_payment").where("flat_id", id).delete();

        // Also delete any notices associated with this flat
        await trx("notice").where("flatId", id).delete();

        // Now delete the flat
        await trx("flat").where("id", id).delete();

        // Decrement the house flat count
        // await trx("house").where("id", flat.house_id).decrement("flatCount", 1);

        await trx.commit();

        return res.json({
          success: true,
          message: "Flat deleted successfully",
        });
      } catch (error) {
        await trx.rollback();
        throw error;
      }
    } catch (error) {
      console.error("Delete flat error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to delete flat",
      });
    }
  }

    // Valid payment methods for advance_payment (must match DB enum)
    static ADVANCE_PAYMENT_METHODS = ['cash', 'bank', 'mobile_banking', 'other'];

    // 6. Assign renter to flat (Updated with advance payment and custom next payment date)
    async assignRenter(req, res) {
      try {
        const { 
          id 
        } = req.params;
        const { 
          renter_id, 
          amenities = [], 
          next_payment_date, // New: Custom next payment date
          advance_payments = [] // New: Array of advance payments
        } = req.body;
        const userId = req.user.id;

        // 1. Require renter_id (prevent "Renter not found" from undefined id)
        if (renter_id == null || renter_id === '') {
          return res.status(400).json({
            success: false,
            error: 'renter_id is required',
          });
        }

        // Get flat with house info
        const flat = await db('flat')
          .join('house', 'flat.house_id', 'house.id')
          .where('flat.id', id)
          .select('flat.*', 'house.ownerId', 'house.metadata as house_metadata')
          .first();

        if (!flat) {
          return res.status(404).json({
            success: false,
            error: 'Flat not found',
          });
        }

        // Check permission
        const role = req.user.role.slug;
        if (role !== 'web_owner') {
          if (role === 'staff') {
            const hasPerm = await hasPermission(userId, 'flats.assign');
            if (!hasPerm) {
              return res.status(403).json({ success: false, error: 'Permission denied||অনুমতি নেই' });
            }
          } else {
            const hasAccess = await this.checkFlatAccess(userId, flat.house_id);
            if (!hasAccess) {
              return res.status(403).json({
                success: false,
                error: 'You do not have permission to assign renter',
              });
            }
          }
        }

        // 2. One renter per flat: check if flat already has a renter (re-checked in transaction for race safety)
        if (flat.renter_id) {
          return res.status(400).json({
            success: false,
            error: 'Flat already has an active renter',
          });
        }

        // Get renter
        const renter = await db('renter').where('id', renter_id).first();
        if (!renter) {
          return res.status(404).json({
            success: false,
            error: 'Renter not found',
          });
        }

        // 3. One flat per renter: renter must not already be assigned to another flat
        const otherFlatWithRenter = await db('flat')
          .where('renter_id', renter_id)
          .whereNot('id', id)
          .first();
        if (otherFlatWithRenter) {
          return res.status(400).json({
            success: false,
            error: 'Renter is already assigned to another flat. Remove them from that flat first.',
          });
        }

        // 4. Validate next_payment_date if provided (avoid Invalid Date in DB)
        const payRentDay = flat.should_pay_rent_day != null ? Number(flat.should_pay_rent_day) : 10;
        let dueDate;
        if (next_payment_date) {
          dueDate = new Date(next_payment_date);
          if (Number.isNaN(dueDate.getTime())) {
            return res.status(400).json({
              success: false,
              error: 'Invalid next_payment_date',
            });
          }
        } else {
          const today = new Date();
          dueDate = new Date(
            today.getFullYear(),
            today.getMonth() + 1,
            payRentDay
          );

          // If today is after the due day this month, use next month
          if (today.getDate() > payRentDay) {
            dueDate = new Date(
              today.getFullYear(),
              today.getMonth() + 2,
              payRentDay
            );
          }
        }

        // Parse house metadata to get default amenities
        let houseMetadata = {};
        try {
          houseMetadata = typeof flat.house_metadata === 'string' 
            ? JSON.parse(flat.house_metadata) 
            : flat.house_metadata || {};
        } catch (e) {
          console.error('Error parsing house metadata:', e);
          houseMetadata = {};
        }

        const defaultAmenities = houseMetadata.amenities || [];
        
        // Process amenities
        let finalAmenities = [];
        if (amenities && amenities.length > 0) {
          finalAmenities = amenities.map(amenity => ({
            name: amenity.name || '',
            charge: parseFloat(amenity.charge) || 0
          }));
        } else if (defaultAmenities.length > 0) {
          finalAmenities = defaultAmenities.map(amenity => ({
            name: amenity.name || '',
            charge: parseFloat(amenity.charge) || 0
          }));
        }

        // Calculate total charges from amenities
        const totalAmenitiesCharge = finalAmenities.reduce(
          (sum, amenity) => sum + (parseFloat(amenity.charge) || 0), 
          0
        );

        // Calculate total rent (base rent + amenities)
        const baseRent = parseFloat(flat.rent_amount) || 0;
        const totalRent = baseRent + totalAmenitiesCharge;

        // Parse existing flat metadata or initialize
        let flatMetadata = {};
        try {
          flatMetadata = flat.metadata && typeof flat.metadata === 'string'
            ? JSON.parse(flat.metadata)
            : flat.metadata || {};
        } catch (e) {
          console.error('Error parsing flat metadata:', e);
          flatMetadata = {};
        }

        // Update flat metadata
        flatMetadata.amenities = finalAmenities;
        flatMetadata.total_rent = totalRent;
        flatMetadata.base_rent = baseRent;
        flatMetadata.total_amenities_charge = totalAmenitiesCharge;
        flatMetadata.assigned_at = new Date().toISOString();
        flatMetadata.assigned_by = userId;
        
        // 5. Validate advance_payments: only allow positive amounts and valid payment_method
        const validAdvancePayments = [];
        if (advance_payments && advance_payments.length > 0) {
          for (const ap of advance_payments) {
            const amount = parseFloat(ap.amount);
            if (!Number.isFinite(amount) || amount <= 0) continue; // skip invalid/zero
            const method = (ap.payment_method || 'cash').toLowerCase();
            if (!FlatController.ADVANCE_PAYMENT_METHODS.includes(method)) {
              return res.status(400).json({
                success: false,
                error: `Invalid advance payment_method "${ap.payment_method}". Allowed: ${FlatController.ADVANCE_PAYMENT_METHODS.join(', ')}`,
              });
            }
            validAdvancePayments.push({ ...ap, amount, payment_method: method });
          }
          flatMetadata.advance_payments_summary = {
            total_advance: validAdvancePayments.reduce((sum, p) => sum + p.amount, 0),
            payment_count: validAdvancePayments.length,
            payments: validAdvancePayments.map(p => ({
              amount: p.amount,
              date: p.payment_date,
              method: p.payment_method
            }))
          };
        }

        // Start transaction
        const trx = await db.transaction();

        try {
          // 6. Update flat only if still no renter (prevents race: two assigns at once)
          const updatePayload = {
            renter_id,
            last_rent_paid_date: null,
            rent_due_date: dueDate,
            next_payment_date: dueDate,
            metadata: JSON.stringify(flatMetadata),
            updatedAt: new Date(),
          };
          const flatUpdateCount = await trx('flat')
            .where('id', id)
            .whereNull('renter_id')
            .update(updatePayload);

          if (flatUpdateCount === 0) {
            await trx.rollback();
            return res.status(400).json({
              success: false,
              error: 'Flat already has an active renter',
            });
          }

          // Create initial rent payment record (one per flat per month via for_month)
          const forMonthStr = `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, '0')}`;
          const rentPayment = {
            uuid: uuidv4(),
            flat_id: id,
            renter_id,
            house_id: flat.house_id,
            amount: totalRent,
            base_amount: baseRent,
            amenities_charge: totalAmenitiesCharge,
            for_month: forMonthStr,
            metadata: JSON.stringify({
              amenities: finalAmenities,
              breakdown: {
                base_rent: baseRent,
                amenities_charge: totalAmenitiesCharge,
                total: totalRent
              }
            }),
            due_date: dueDate,
            status: 'pending',
            created_at: new Date(),
            updated_at: new Date(),
          };

          await trx('rent_payment').insert(rentPayment);

          // Process advance payments (only validated, positive-amount entries)
          if (validAdvancePayments.length > 0) {
            for (const advancePayment of validAdvancePayments) {
              const advanceRecord = {
                uuid: uuidv4(),
                renter_id,
                flat_id: id,
                house_id: flat.house_id,
                amount: advancePayment.amount,
                paid_amount: Number(advancePayment.paid_amount) || advancePayment.amount,
                remaining_amount: advancePayment.amount,
                status: 'paid',
                payment_date: advancePayment.payment_date ? new Date(advancePayment.payment_date) : new Date(),
                payment_method: advancePayment.payment_method,
                transaction_id: advancePayment.transaction_id || null,
                notes: advancePayment.notes || null,
                metadata: JSON.stringify({
                  type: 'advance',
                  for_months: advancePayment.for_months || 0,
                  description: advancePayment.description || 'Advance payment'
                }),
                created_at: new Date(),
                updated_at: new Date(),
              };
              await trx('advance_payment').insert(advanceRecord);
            }
          }

          // Also update renter metadata with advance payments info
          let renterMetadata = {};
          try {
            renterMetadata = renter.metadata && typeof renter.metadata === 'string'
              ? JSON.parse(renter.metadata)
              : renter.metadata || {};
          } catch (e) {
            console.error('Error parsing renter metadata:', e);
            renterMetadata = {};
          }

          if (validAdvancePayments.length > 0) {
            renterMetadata.advance_payments = validAdvancePayments.map(payment => ({
              paid_amount: payment.amount,
              date: payment.payment_date || new Date().toISOString(),
              method: payment.payment_method,
              flat_id: id,
              house_id: flat.house_id,
              description: payment.description || 'Advance payment'
            }));
            renterMetadata.current_flat_id = id;
            renterMetadata.current_house_id = flat.house_id;

            await trx('renter').where('id', renter_id).update({
              metadata: JSON.stringify(renterMetadata),
              updatedAt: new Date(),
            });
          }

          await trx.commit();

          // Notify house owner + caretakers about the new renter assignment
          notify.notifyHouseStakeholders(
            flat.house_id,
            {
              title: 'Renter Assigned',
              message: `${renter.name || 'A renter'} has been assigned to Flat #${id}`,
              type: 'info',
              redirectLink: `/flats/${id}`,
            },
            userId,
          ).catch((e) => console.error('[notify] assignRenter:', e));

          return res.json({
            success: true,
            data: {
              flatId: id,
              renterId: renter_id,
              nextDueDate: dueDate,
              totalRent: totalRent,
              nextPaymentDate: next_payment_date || dueDate.toISOString().split('T')[0],
              advancePayments: validAdvancePayments,
              breakdown: {
                baseRent: baseRent,
                amenitiesCharge: totalAmenitiesCharge,
                amenities: finalAmenities
              }
            },
            message: 'Renter assigned successfully with advance payments',
          });
        } catch (error) {
          await trx.rollback();
          throw error;
        }
      } catch (error) {
        console.error('Assign renter error:', error);
        return res.status(500).json({
          success: false,
          error: 'Failed to assign renter',
        });
      }
    }

    // Helper: get for_month YYYY-MM from a Date
    getForMonth(date) {
      if (!date || !(date instanceof Date) || isNaN(date.getTime())) return null;
      const y = date.getFullYear();
      const m = date.getMonth() + 1;
      return `${y}-${String(m).padStart(2, '0')}`;
    }

    // Apply advance payment to a rent payment; optional cash from renter and create next month due
    async applyAdvancePayment(req, res) {
      try {
        const { id: flat_id } = req.params;
        const {
          advance_payment_id,
          rent_payment_id,
          amount,
          cash_paid_amount, // optional: renter-paid remaining (e.g. 6000 when closing month)
          create_next_due, // optional: when rent becomes paid, create next month's due
        } = req.body;
        const userId = req.user.id;

        // Get flat and check permissions (need house for next-due creation)
        const flat = await db('flat')
          .join('house', 'flat.house_id', 'house.id')
          .where('flat.id', flat_id)
          .select('flat.*', 'house.ownerId')
          .first();

        if (!flat) {
          return res.status(404).json({
            success: false,
            error: 'Flat not found',
          });
        }

        // Check permission
        if (req.user.role.slug !== 'web_owner') {
          const hasAccess = await this.checkFlatAccess(userId, flat.house_id);
          if (!hasAccess) {
            return res.status(403).json({
              success: false,
              error: 'You do not have permission',
            });
          }
        }

        // Get advance payment
        const advancePayment = await db('advance_payment')
          .where('id', advance_payment_id)
          .andWhere('flat_id', flat_id)
          .first();

        if (!advancePayment) {
          return res.status(404).json({
            success: false,
            error: 'Advance payment not found',
          });
        }

        // Get rent payment
        const rentPayment = await db('rent_payment')
          .where('id', rent_payment_id)
          .andWhere('flat_id', flat_id)
          .first();

        if (!rentPayment) {
          return res.status(404).json({
            success: false,
            error: 'Rent payment not found',
          });
        }

        const applyAmount = parseFloat(amount) || parseFloat(advancePayment.remaining_amount) || 0;
        const cashPaid = Number.isFinite(parseFloat(cash_paid_amount)) ? Math.max(0, parseFloat(cash_paid_amount)) : 0;

        if (applyAmount <= 0) {
          return res.status(400).json({
            success: false,
            error: 'Invalid amount',
          });
        }

        if (applyAmount > advancePayment.remaining_amount) {
          return res.status(400).json({
            success: false,
            error: 'Amount exceeds remaining advance payment',
          });
        }

        const trx = await db.transaction();

        try {
          // Update advance payment
          const newRemaining = parseFloat(advancePayment.remaining_amount) - applyAmount;
          const advanceStatus = newRemaining > 0 ? 'partially_used' : 'fully_used';

          await trx('advance_payment')
            .where('id', advance_payment_id)
            .update({
              remaining_amount: newRemaining,
              status: advanceStatus,
              updated_at: new Date(),
            });

          // Total paid for this month = existing + advance applied + optional cash from renter
          const currentPaid = parseFloat(rentPayment.paid_amount) || 0;
          const newPaid = currentPaid + applyAmount + cashPaid;
          const rentStatus = newPaid >= rentPayment.amount ? 'paid' :
            newPaid > 0 ? 'partial' : 'pending';

          // Track total advance used on this rent_payment
          const existingAdvanceUsed =
            rentPayment.advance_used != null
              ? parseFloat(rentPayment.advance_used)
              : 0;
          const newAdvanceUsed = existingAdvanceUsed + applyAmount;

          // Merge advance_payment_used into metadata (keep array of applications)
          let meta = {};
          try {
            meta = rentPayment.metadata && typeof rentPayment.metadata === 'string'
              ? JSON.parse(rentPayment.metadata)
              : rentPayment.metadata || {};
          } catch (e) {
            meta = {};
          }
          const advanceUsedList = Array.isArray(meta.advance_payment_used)
            ? meta.advance_payment_used
            : (meta.advance_payment_used ? [meta.advance_payment_used] : []);
          advanceUsedList.push({
            advance_payment_id,
            amount: applyAmount,
            applied_at: new Date().toISOString(),
          });
          if (cashPaid > 0) {
            meta.renter_paid_remaining = (meta.renter_paid_remaining || 0) + cashPaid;
          }
          meta.advance_payment_used = advanceUsedList;

          const rentUpdatePayload = {
            paid_amount: newPaid,
            advance_used: newAdvanceUsed,
            status: rentStatus,
            updated_at: new Date(),
            metadata: JSON.stringify(meta),
          };
          if (rentStatus !== 'pending' && rentPayment.paid_date == null) {
            rentUpdatePayload.paid_date = new Date();
          }
          await trx('rent_payment').where('id', rent_payment_id).update(rentUpdatePayload);

          let nextDueDate = null;
          let nextForMonth = null;

          // When rent becomes paid and create_next_due is true, create next month's due (one per flat per month)
          if (String(create_next_due) === 'true' && rentStatus === 'paid' && flat.renter_id) {
            const payDay = flat.should_pay_rent_day != null ? Number(flat.should_pay_rent_day) : 10;
            const dueDate = rentPayment.due_date ? new Date(rentPayment.due_date) : new Date();
            const nextMonth = new Date(dueDate.getFullYear(), dueDate.getMonth() + 1, payDay);
            nextDueDate = nextMonth;
            nextForMonth = this.getForMonth(nextMonth);

            const existingNext = await trx('rent_payment')
              .where('flat_id', flat_id)
              .andWhere('for_month', nextForMonth)
              .first();
            if (!existingNext) {
              let flatMeta = {};
              try {
                flatMeta = flat.metadata && typeof flat.metadata === 'string'
                  ? JSON.parse(flat.metadata)
                  : flat.metadata || {};
              } catch (e) {
                flatMeta = {};
              }
              const nextAmenities = flatMeta.amenities || [];
              const nextAmenitiesCharge = nextAmenities.reduce((s, a) => s + (parseFloat(a.charge) || 0), 0);
              const baseRent = parseFloat(flat.rent_amount) || 0;
              const nextTotal = baseRent + nextAmenitiesCharge;
              const nextPayment = {
                uuid: uuidv4(),
                flat_id,
                renter_id: flat.renter_id,
                house_id: flat.house_id,
                amount: nextTotal,
                base_amount: baseRent,
                amenities_charge: nextAmenitiesCharge,
                for_month: nextForMonth,
                due_date: nextMonth,
                status: 'pending',
                metadata: JSON.stringify({
                  amenities: nextAmenities,
                  breakdown: { base_rent: baseRent, amenities_charge: nextAmenitiesCharge, total: nextTotal },
                }),
                created_at: new Date(),
                updated_at: new Date(),
              };
              await trx('rent_payment').insert(nextPayment);
              await trx('flat').where('id', flat_id).update({
                rent_due_date: nextMonth,
                updatedAt: new Date(),
              });
            }
          }

          await trx.commit();

          return res.json({
            success: true,
            data: {
              advance_payment_id,
              rent_payment_id,
              amount_applied: applyAmount,
              cash_paid_amount: cashPaid,
              remaining_advance: newRemaining,
              rent_status: rentStatus,
              total_paid_for_month: newPaid,
              nextDueDate: nextDueDate ? nextDueDate.toISOString().split('T')[0] : null,
              nextForMonth,
            },
            message: 'Advance payment applied successfully',
          });
        } catch (error) {
          await trx.rollback();
          throw error;
        }
      } catch (error) {
        console.error('Apply advance payment error:', error);
        return res.status(500).json({
          success: false,
          error: 'Failed to apply advance payment',
        });
      }
    }

    // Add this method to get advance payments for a flat
    async getFlatAdvancePayments(req, res) {
      try {
        const { id: flat_id } = req.params;
        const userId = req.user.id;

        // Get flat and check permissions
        const flat = await db('flat')
          .join('house', 'flat.house_id', 'house.id')
          .where('flat.id', flat_id)
          .select('flat.*', 'house.ownerId')
          .first();

        if (!flat) {
          return res.status(404).json({
            success: false,
            error: 'Flat not found',
          });
        }

        // Check permission
        if (req.user.role.slug !== 'web_owner') {
          const hasAccess = await this.checkFlatAccess(userId, flat.house_id);
          if (!hasAccess) {
            return res.status(403).json({
              success: false,
              error: 'You do not have permission',
            });
          }
        }

        // Get advance payments
        const advancePayments = await db('advance_payment')
          .where('flat_id', flat_id)
          .orderBy('payment_date', 'desc');

        return res.json({
          success: true,
          data: advancePayments,
        });
      } catch (error) {
        console.error('Get advance payments error:', error);
        return res.status(500).json({
          success: false,
          error: 'Failed to fetch advance payments',
        });
      }
    }

    // Create advance payment (when house owner forgot at assignment)
    async createAdvancePayment(req, res) {
      try {
        const { id: flat_id } = req.params;
        const { amount, payment_method, payment_date, transaction_id, notes } = req.body;
        const userId = req.user.id;

        const flat = await db('flat')
          .join('house', 'flat.house_id', 'house.id')
          .where('flat.id', flat_id)
          .select('flat.*', 'house.ownerId')
          .first();

        if (!flat) {
          return res.status(404).json({ success: false, error: 'Flat not found||ফ্ল্যাট খুঁজে পাওয়া যায়নি' });
        }

        if (req.user.role.slug !== 'web_owner') {
          const hasAccess = await this.checkFlatAccess(userId, flat.house_id);
          if (!hasAccess) {
            return res.status(403).json({ success: false, error: 'Permission denied||অনুমতি প্রদান করা হয়নি' });
          }
        }

        const amt = parseFloat(amount);
        if (!Number.isFinite(amt) || amt <= 0) {
          return res.status(400).json({
            success: false,
            error: 'amount must be a positive number||প্রদানকৃত পরিমাণ হতে হবে একটি ধনাত্মক সংখ্যা',
          });
        }

        const method = (payment_method || 'cash').toLowerCase();
        if (!FlatController.ADVANCE_PAYMENT_METHODS.includes(method)) {
          return res.status(400).json({
            success: false,
            error: `Invalid payment_method. Allowed: ${FlatController.ADVANCE_PAYMENT_METHODS.join(', ')}`,
          });
        }

        
        if (!flat.renter_id) {
          return res.status(400).json({
            success: false,
            error: 'Flat has no renter. Advance can only be added for occupied flats.||ফ্ল্যাট এর কোনো রেন্টার নেই।',
          });
        }

        

        const payDate = payment_date ? new Date(payment_date) : new Date();
        const advance = {
          uuid: uuidv4(),
          renter_id: flat.renter_id,
          flat_id,
          house_id: flat.house_id,
          amount: amt,
          paid_amount: amt,
          remaining_amount: amt,
          status: 'paid',
          payment_date: payDate,
          payment_method: method,
          transaction_id: transaction_id || null,
          notes: notes || null,
          metadata: JSON.stringify({ type: 'advance', description: 'Advance payment (added later)' }),
          created_at: new Date(),
          updated_at: new Date(),
        };

        const [advanceId] = await db('advance_payment').insert(advance);

        return res.status(201).json({
          success: true,
          data: { id: advanceId, ...advance },
          message: 'Advance payment created',
        });
      } catch (error) {
        console.error('Create advance payment error:', error);
        return res.status(500).json({
          success: false,
          error: 'Failed to create advance payment',
        });
      }
    }

    // Update advance payment - only paid_amount; safe mutation of amount/remaining_amount
    async updateAdvancePayment(req, res) {
      try {
        const { flatId, advanceId } = req.params;
        const { paid_amount } = req.body;
        const userId = req.user.id;

        const newPaidAmount = parseFloat(paid_amount);
        if (!Number.isFinite(newPaidAmount) || newPaidAmount <= 0) {
          return res.status(400).json({
            success: false,
            error: 'Paid Amount must be a positive number||প্রদানকৃত পরিমাণ হতে হবে একটি ধনাত্মক সংখ্যা',
          });
        }

        const advance = await db('advance_payment')
          .join('flat', 'advance_payment.flat_id', 'flat.id')
          .join('house', 'flat.house_id', 'house.id')
          .where('advance_payment.id', advanceId)
          .andWhere('advance_payment.flat_id', flatId)
          .select('advance_payment.*', 'house.ownerId')
          .first();

        if (!advance) {
          return res.status(404).json({ success: false, error: 'Advance payment not found||এডভান্স পেমেন্ট খুঁজে পাওয়া যায়নি' });
        }

        if (req.user.role.slug !== 'web_owner') {
          const hasAccess = await this.checkFlatAccess(userId, advance.house_id);
          if (!hasAccess) {
            return res.status(403).json({ success: false, error: 'Permission denied||অনুমতি প্রদান করা হয়নি' });
          }
        }

        const currentPaid = parseFloat(advance.paid_amount || 0);
        const currentRemaining = parseFloat(advance.remaining_amount || 0);

        let newRemaining;
        if (newPaidAmount > currentPaid) {
          const delta = newPaidAmount - currentPaid;
          newRemaining = currentRemaining + delta;
        } else if (newPaidAmount < currentPaid) {
          const decreased = currentPaid - newPaidAmount;
          if (currentRemaining - decreased < 0) {
            return res.status(400).json({
              success: false,
              error: 'Cannot decrease paid amount: would make remaining amount negative. Advance has already been used..||এডভান্স পেমেন্ট এর পরিমান কমানো যাবে না: রিমেইনিং এমাউন্ট নেগেটিভ হবে। এডভান্স ইতিমধ্যে ব্যবহার করা হয়েছে।',
            });
          }
          newRemaining = currentRemaining - decreased;
        } else {
          return res.json({
            success: true,
            data: advance,
            message: 'No change||কোনো পরিবর্তন হয়নি',
          });
        }

        await db('advance_payment')
          .where('id', advanceId)
          .update({
            amount: newPaidAmount,
            paid_amount: newPaidAmount,
            remaining_amount: newRemaining,
            updated_at: new Date(),
          });

        const updatedAdvance = await db('advance_payment').where('id', advanceId).first();
        return res.json({
          success: true,
          data: updatedAdvance,
          message: 'Advance payment updated',
        });
      } catch (error) {
        console.error('Update advance payment error:', error);
        return res.status(500).json({
          success: false,
          error: 'Failed to update advance payment||এডভান্স পেমেন্ট আপডেট করতে ব্যর্থ হয়েছে' + error.message,
        });
      }
    }

    // Delete advance payment - only when remaining_amount === paid_amount (never used)
    async deleteAdvancePayment(req, res) {
      try {
        const { flatId, advanceId } = req.params;
        const userId = req.user.id;
        
        const advance = await db('advance_payment')
          .join('flat', 'advance_payment.flat_id', 'flat.id')
          .where('advance_payment.id', advanceId)
          .andWhere('advance_payment.flat_id', flatId)
          .select('advance_payment.*')
          .first();

        if (!advance) {
          return res.status(404).json({ success: false, error: 'Advance payment not found||এডভান্স পেমেন্ট খুঁজে পাওয়া যায়নি' });
        }

        if (req.user.role.slug !== 'web_owner') {
          const hasAccess = await this.checkFlatAccess(userId, advance.house_id);
          if (!hasAccess) {
            return res.status(403).json({ success: false, error: 'Permission denied||অনুমতি প্রদান করা হয়নি' });
          }
        }

        

        const paid = parseFloat(advance.paid_amount || 0);
        const remaining = parseFloat(advance.remaining_amount || 0);

        if (remaining !== paid) {
          return res.status(400).json({
            success: false,
            error: 'Cannot delete: advance has been used. remaining amount must equal paid amount to delete.||ডিলিট করা যাবে না: এডভান্স ব্যবহার করা হয়েছে। রিমেইনিং এমাউন্ট এবং পেমেন্ট এমাউন্ট সমান হতে হবে।',
          });
        }

        await db('advance_payment').where('id', advanceId).del();

        return res.json({
          success: true,
          message: 'Advance payment deleted||এডভান্স পেমেন্ট ডিলিট করা হয়েছে',
        });
      } catch (error) {
        console.error('Delete advance payment error:', error);
        return res.status(500).json({
          success: false,
          error: 'Failed to delete advance payment||এডভান্স পেমেন্ট ডিলিট করতে ব্যর্থ হয়েছে' + error.message,
        });
      }
    }

  // 7. Remove renter from flat (fresh state: no dues from renter; advance cleared / refund recorded)
  // Body: { refund_amount? } - optional; if omitted, uses actual_remaining. House owner can record custom amount.
  async removeRenter(req, res) {
    try {
      const { id } = req.params;
      const { refund_amount: refundAmountFromBody } = req.body || {};
      const userId = req.user.id;

      // Get flat with house and owner info
      const flat = await db("flat")
        .join("house", "flat.house_id", "house.id")
        .leftJoin("user as house_owner", "house.ownerId", "house_owner.id")
        .where("flat.id", id)
        .select("flat.*", "house.ownerId", "house.name as house_name", "house_owner.name as house_owner_name")
        .first();

      if (!flat) {
        return res.status(404).json({
          success: false,
          error: "Flat not found||ফ্ল্যাট খুঁজে পাওয়া যায়নি",
        });
      }

      // Check permission
      if (req.user.role.slug !== "web_owner") {
        const hasAccess = await this.checkFlatAccess(userId, flat.house_id);
        if (!hasAccess) {
          return res.status(403).json({
            success: false,
            error: "You do not have permission to remove renter||রেন্টার সরানো যাবে না: আপনি অনুমতি প্রদান করা হয়নি",
          });
        }
      }

      // Check if flat has renter
      if (!flat.renter_id) {
        return res.status(400).json({
          success: false,
          error: "Flat does not have an active renter||ফ্ল্যাট এর কোনো সক্রিয় রেন্টার নেই",
        });
      }

      // Block if renter has any unpaid/partially paid rent
      const duesFromRenter = await db("rent_payment")
        .where("flat_id", id)
        .andWhere("status", "in", ["pending", "overdue", "partial"])
        .select("id", "amount", "paid_amount", "due_date", "for_month");

      if (duesFromRenter.length > 0) {
        return res.status(400).json({
          success: false,
          error: "Cannot remove renter while they have unpaid or partially paid rent. Clear dues first.||রেন্টার সরানো যাবে না: রেন্টার এর কোনো অসমাপ্ত বকেয়া থাকলে সরানো যাবে না। বকেয়া সমাপ্ত করুন।",
          pendingPayments: duesFromRenter,
        });
      }

      // Fetch advances with remaining (need id, remaining_amount, amount, metadata)
      const advanceWithRemaining = await db("advance_payment")
        .where("flat_id", id)
        .andWhere("renter_id", flat.renter_id)
        .andWhere("remaining_amount", ">", 0)
        .select("id", "remaining_amount", "amount", "metadata");

      const actualRemaining = advanceWithRemaining.reduce(
        (sum, row) => sum + parseFloat(row.remaining_amount || 0),
        0
      );
      const refundAmount = Number.isFinite(parseFloat(refundAmountFromBody))
        ? Math.max(0, parseFloat(refundAmountFromBody))
        : actualRemaining;

      const trx = await db.transaction();

      try {
        const now = new Date();
        const property = {
          flat_id: id,
          house_id: flat.house_id,
          house_name: flat.house_name,
          house_owner_name: flat.house_owner_name || null,
        };

        // Clear each advance and update its metadata with refund_status
        for (let i = 0; i < advanceWithRemaining.length; i++) {
          const adv = advanceWithRemaining[i];
          const advRemaining = parseFloat(adv.remaining_amount || 0);
          let advMeta = {};
          try {
            advMeta = adv.metadata && typeof adv.metadata === "string"
              ? JSON.parse(adv.metadata)
              : adv.metadata || {};
          } catch (e) {
            advMeta = {};
          }
          const refundStatusEntry = { amount: refundAmount, actual_remaining: advRemaining };
          const existingRefundStatus = Array.isArray(advMeta.refund_status) ? advMeta.refund_status : [];
          existingRefundStatus.push(refundStatusEntry);
          advMeta.refund_status = existingRefundStatus;

          await trx("advance_payment")
            .where("id", adv.id)
            .update({
              remaining_amount: 0,
              status: "refunded",
              metadata: JSON.stringify(advMeta),
              updated_at: now,
            });
        }

        // Update renter.metadata.refund_status (optimized: no spread)
        if (advanceWithRemaining.length > 0) {
          const renter = await trx("renter").where("id", flat.renter_id).first();
          if (renter) {
            let renterMeta = {};
            try {
              renterMeta = renter.metadata && typeof renter.metadata === "string"
                ? JSON.parse(renter.metadata)
                : renter.metadata || {};
            } catch (e) {
              renterMeta = {};
            }
            const refundStatusList = Array.isArray(renterMeta.refund_status) ? renterMeta.refund_status : [];
            refundStatusList.push({
              property,
              date: now.getTime(),
              amount: refundAmount,
              actual_remaining: actualRemaining,
            });
            renterMeta.refund_status = refundStatusList;

            await trx("renter")
              .where("id", flat.renter_id)
              .update({
                metadata: JSON.stringify(renterMeta),
                updatedAt: now,
              });
          }

          // House expense record for refund (amount = refund_amount, metadata with renter_id, flat_id, reason)
          const expenseMeta = JSON.stringify({
            renter_id: flat.renter_id,
            flat_id: id,
            reason: "removed_from_flat",
          });
          await trx("house_expense").insert({
            uuid: uuidv4(),
            house_id: flat.house_id,
            category: "other",
            amount: refundAmount,
            description: "Advance refund to renter (removed from flat)",
            expense_date: now,
            status: "approved",
            approved_by: userId,
            paid_by: userId,
            metadata: expenseMeta,
            created_at: now,
            updated_at: now,
          });
        }

        // Update flat (fresh for new renter)
        await trx("flat").where("id", id).update({
          renter_id: null,
          last_rent_paid_date: null,
          rent_due_date: null,
          updatedAt: now,
        });

        // Mark all future rent payments as cancelled
        await trx("rent_payment")
          .where("flat_id", id)
          .andWhere("due_date", ">", now)
          .andWhere("status", "pending")
          .update({
            status: "cancelled",
            updated_at: now,
          });

        await trx.commit();

        // Notify house owner + caretakers about the renter removal
        notify.notifyHouseStakeholders(
          flat.house_id,
          {
            title: 'Renter Removed',
            message: `A renter has been removed from Flat #${id}${flat.house_name ? ` – ${flat.house_name}` : ''}`,
            type: 'warning',
            redirectLink: `/flats/${id}`,
          },
          userId,
        ).catch((e) => console.error('[notify] removeRenter:', e));

        return res.json({
          success: true,
          message: advanceWithRemaining.length > 0
            ? "Renter removed. Advance cleared. Refund recorded."
            : "Renter removed successfully",
          refund: advanceWithRemaining.length > 0
            ? { amount: refundAmount, actual_remaining: actualRemaining, renter_id: flat.renter_id }
            : null,
        });
      } catch (error) {
        await trx.rollback();
        throw error;
      }
    } catch (error) {
      console.error("Remove renter error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to remove renter",
      });
    }
  }

  // Helper method to check flat access
  async checkFlatAccess(userId, houseId) {
    const result = await db("house")
      .leftJoin("caretakerassignment", function () {
        this.on("house.id", "=", "caretakerassignment.houseId").andOnVal(
          "caretakerassignment.expiresAt",
          ">",
          new Date()
        );
      })
      .where("house.id", houseId)
      .andWhere(function () {
        this.where("house.ownerId", userId).orWhere(
          "caretakerassignment.caretakerId",
          userId
        );
      })
      .select("house.id")
      .first();

    return !!result;
  }

  // Helper method to recalculate rent due date
  async recalculateRentDueDate(flatId, updates) {
    const flat = await db("flat").where("id", flatId).first();
    if (!flat.renter_id) return;

    const today = new Date();
    let dueDate = flat.rent_due_date
      ? new Date(flat.rent_due_date)
      : new Date();

    // Recalculate based on should_pay_rent_day
    if (updates.should_pay_rent_day) {
      dueDate.setDate(updates.should_pay_rent_day);

      // If the due date has passed, move to next month
      if (dueDate < today) {
        dueDate.setMonth(dueDate.getMonth() + 1);
      }
    }

    await db("flat").where("id", flatId).update({
      rent_due_date: dueDate,
      updatedAt: new Date(),
    });

    // Update pending rent payments
    await db("rent_payment")
      .where("flat_id", flatId)
      .andWhere("due_date", ">=", today)
      .andWhere("status", "pending")
      .update({
        due_date: dueDate,
        updated_at: new Date(),
      });
  }
}

module.exports = new FlatController();
