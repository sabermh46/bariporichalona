// FlatController.js - Updated with consistent column naming
const db = require("../config/knex");
const { v4: uuidv4 } = require("uuid");
const { hasPermission } = require("../services/permission.service");

class FlatController {
  // 1. Create flat (with flatCount limit check)
  async createFlat(req, res) {
    try {
      const { number, name, rent_amount, should_pay_rent_day } = req.body;
      const userId = req.user.id;
      const { houseId } = req.params; // From URL params

      console.log("House ID from params:", houseId);
      console.log("Request body:", req.body);
      console.log("User ID:", userId);
      console.log("User role:", req.user.role?.slug);

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
          should_pay_rent_day: should_pay_rent_day || 10,
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

      console.log(
        "Current flat count:",
        currentFlatCount.count,
        "Max allowed:",
        house.flatCount
      );

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
        should_pay_rent_day: should_pay_rent_day || 10,
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
      const { house_id, status, search, page = 1, limit = 20 } = req.query;
      const userId = req.user.id;
      const offset = (page - 1) * limit;

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
      if (req.user.role.slug !== "web_owner") {
        query.where(function () {
          this.where("house.ownerId", userId)
            .orWhereExists(function () {
              this.select("*")
                .from("caretakerassignment")
                .whereRaw("caretakerassignment.houseId = house.id")
                .andWhere("caretakerassignment.caretakerId", userId)
                .andWhere("caretakerassignment.expiresAt", ">", new Date())
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

        console.log(flat);
        

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
            error: "You do not have permission to view this flat",
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
      const updates = req.body;
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
            error: "You do not have permission to update this flat",
          });
        }
      }

      // Prepare update data
      const updateData = {
        ...updates,
        updated_at: new Date(),
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

  // 5. Delete flat (only if no active renter)
  async deleteFlat(req, res) {
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
        const ownerId = flat.ownerId || flat.owner_id;
        if (ownerId !== userId) {
          return res.status(403).json({
            success: false,
            error: "Only the house owner can delete flats",
          });
        }
      }

      // Check if flat has active renter
      if (flat.renter_id) {
        return res.status(400).json({
          success: false,
          error: "Cannot delete flat with active renter. Remove renter first.",
        });
      }

      // Check if there are pending payments
      const pendingPayments = await db("rent_payment")
        .where("flat_id", id)
        .andWhere("status", "in", ["pending", "overdue"])
        .first();

      if (pendingPayments) {
        return res.status(400).json({
          success: false,
          error: "Cannot delete flat with pending payments",
        });
      }

      // Soft delete or hard delete based on permission
      if (req.user.role.slug === "web_owner") {
        await db("flat").where("id", id).delete();
      } else {
        // Soft delete
        await db("flat").where("id", id).update({
          deleted_at: new Date(),
          renter_id: null,
          updated_at: new Date(),
        });
      }

      // Update house flat count
      await db("house").where("id", flat.house_id).decrement("flatCount", 1);

      return res.json({
        success: true,
        message: "Flat deleted successfully",
      });
    } catch (error) {
      console.error("Delete flat error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to delete flat",
      });
    }
  }

  // 6. Assign renter to flat
  async assignRenter(req, res) {
    try {
      const { id } = req.params;
      const { renter_id } = req.body;
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
            error: "You do not have permission to assign renter",
          });
        }
      }

      // Check if flat already has renter
      if (flat.renter_id) {
        return res.status(400).json({
          success: false,
          error: "Flat already has an active renter",
        });
      }

      // Get renter
      const renter = await db("renter").where("id", renter_id).first();
      if (!renter) {
        return res.status(404).json({
          success: false,
          error: "Renter not found",
        });
      }

      // Calculate next rent due date
      const today = new Date();
      let dueDate = new Date(
        today.getFullYear(),
        today.getMonth() + 1,
        flat.should_pay_rent_day
      );

      // If today is after the due day this month, use next month
      if (today.getDate() > flat.should_pay_rent_day) {
        dueDate = new Date(
          today.getFullYear(),
          today.getMonth() + 2,
          flat.should_pay_rent_day
        );
      }

      // Start transaction
      const trx = await db.transaction();

      try {
        // Update flat
        await trx("flat").where("id", id).update({
          renter_id,
          last_rent_paid_date: null,
          rent_due_date: dueDate,
          updated_at: new Date(),
        });

        // Create initial rent payment record
        const rentPayment = {
          uuid: uuidv4(),
          flat_id: id,
          renter_id,
          house_id: flat.house_id,
          amount: flat.rent_amount || 0,
          due_date: dueDate,
          status: "pending",
          created_at: new Date(),
          updated_at: new Date(),
        };

        await trx("rent_payment").insert(rentPayment);

        await trx.commit();

        return res.json({
          success: true,
          data: {
            flatId: id,
            renterId: renter_id,
            nextDueDate: dueDate,
          },
          message: "Renter assigned successfully",
        });
      } catch (error) {
        await trx.rollback();
        throw error;
      }
    } catch (error) {
      console.error("Assign renter error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to assign renter",
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
          updated_at: new Date(),
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
        this.on("house.id", "=", "caretakerassignment.house_id").andOn(
          "caretakerassignment.expires_at",
          ">",
          new Date()
        );
      })
      .where("house.id", houseId)
      .andWhere(function () {
        this.where("house.ownerId", userId)
          .orWhere("caretakerassignment.caretakerId", userId)
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
      updated_at: new Date(),
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
