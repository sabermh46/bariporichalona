// flat.controller.js - Updated with consistent column naming
const db = require("../config/knex");
const { v4: uuidv4 } = require("uuid");
const { hasPermission } = require("../services/permission.service");
const { getAccessibleHouseOwners } = require("./common/index");
const CaretakerPermissionService = require("../services/CaretakerPermission.service");

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
      const { status, search, page = 1, limit = 20 } = req.query;
      const userId = req.user.id;
      const offset = (page - 1) * limit;

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
          page: parseInt(page),
          limit: parseInt(limit),
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
        .where("flat.id", id)
        .select(
          "flat.*",
          "house.name as houseName",
          "house.address as houseAddress",
          "house.ownerId",
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
      if (req.user.role.slug !== "web_owner") {
        const hasAccess = await this.checkFlatAccess(userId, flat.house_id);
        if (!hasAccess) {
          return res.status(403).json({
            success: false,
            error: "You do not have permission to update this flat",
          });
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
        if (req.user.role.slug !== "web_owner") {
          const ownerId = flat.ownerId || flat.owner_id;
          if (ownerId !== userId) {
            await trx.rollback();
            return res.status(403).json({
              success: false,
              error: "Only the house owner can delete flats",
            });
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
        if (req.user.role.slug !== 'web_owner') {
          const hasAccess = await this.checkFlatAccess(userId, flat.house_id);
          if (!hasAccess) {
            return res.status(403).json({
              success: false,
              error: 'You do not have permission to assign renter',
            });
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

          // Create initial rent payment record
          const rentPayment = {
            uuid: uuidv4(),
            flat_id: id,
            renter_id,
            house_id: flat.house_id,
            amount: totalRent,
            base_amount: baseRent,
            amenities_charge: totalAmenitiesCharge,
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

    // Add this method to apply advance payment to rent
    async applyAdvancePayment(req, res) {
      try {
        const { id: flat_id } = req.params;
        const { advance_payment_id, rent_payment_id, amount } = req.body;
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

          // Update rent payment
          const currentPaid = parseFloat(rentPayment.paid_amount) || 0;
          const newPaid = currentPaid + applyAmount;
          const rentStatus = newPaid >= rentPayment.amount ? 'paid' : 
                            newPaid > 0 ? 'partial' : 'pending';

          await trx('rent_payment')
            .where('id', rent_payment_id)
            .update({
              paid_amount: newPaid,
              status: rentStatus,
              updated_at: new Date(),
              metadata: JSON.stringify({
                ...(rentPayment.metadata ? JSON.parse(rentPayment.metadata) : {}),
                advance_payment_used: {
                  advance_payment_id,
                  amount: applyAmount,
                  applied_at: new Date().toISOString()
                }
              }),
            });

          await trx.commit();

          return res.json({
            success: true,
            data: {
              advance_payment_id,
              rent_payment_id,
              amount_applied: applyAmount,
              remaining_advance: newRemaining,
              rent_status: rentStatus,
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

  // 7. Remove renter from flat
  async removeRenter(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

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
      if (req.user.role.slug !== "web_owner") {
        const hasAccess = await this.checkFlatAccess(userId, flat.house_id);
        if (!hasAccess) {
          return res.status(403).json({
            success: false,
            error: "You do not have permission to remove renter",
          });
        }
      }

      // Check if flat has renter
      if (!flat.renter_id) {
        return res.status(400).json({
          success: false,
          error: "Flat does not have an active renter",
        });
      }

      // Check for pending payments
      const pendingPayments = await db("rent_payment")
        .where("flat_id", id)
        .andWhere("status", "in", ["pending", "overdue"])
        .select("id", "amount", "due_date");

      if (pendingPayments.length > 0) {
        return res.status(400).json({
          success: false,
          error: "Cannot remove renter with pending payments",
          pendingPayments,
        });
      }

      // Start transaction
      const trx = await db.transaction();

      try {
        // Update flat
        await trx("flat").where("id", id).update({
          renter_id: null,
          last_rent_paid_date: null,
          rent_due_date: null,
          updatedAt: new Date(),
        });

        // Mark all future rent payments as cancelled
        await trx("rent_payment")
          .where("flat_id", id)
          .andWhere("due_date", ">", new Date())
          .andWhere("status", "pending")
          .update({
            status: "cancelled",
            updated_at: new Date(),
          });

        await trx.commit();

        return res.json({
          success: true,
          message: "Renter removed successfully",
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
