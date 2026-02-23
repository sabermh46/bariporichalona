// Updated financial.controller.js with snake_case column names
const db = require('../config/knex');
const { v4: uuidv4 } = require('uuid');
const NotificationService = require('../services/emailSmsNotification.service');
const CaretakerPermissionService = require('../services/CaretakerPermission.service');
const HouseController = require('./house.controller');
const permissionService = require('../services/permission.service');
const accessCache = require('../utils/accessCache');
const { serializeBigInt } = require('../utils/serializer');
class FinancialController {
  constructor() {
    // bind all to fix the this.function() reading indefined
    this.recordRentPayment = this.recordRentPayment.bind(this);
    this.generateRentInvoices = this.generateRentInvoices.bind(this);
    this.recordExpense = this.recordExpense.bind(this);
    this.recordAppFeePayment = this.recordAppFeePayment.bind(this);
    this.getFinancialDashboard = this.getFinancialDashboard.bind(this);
    this.sendRentReminders = this.sendRentReminders.bind(this);
    this.checkHouseAccess = this.checkHouseAccess.bind(this);
    this.calculateNextDueDate = this.calculateNextDueDate.bind(this);
    this.calculateMonthlyProfit = this.calculateMonthlyProfit.bind(this);
    this.getProfitReport = this.getProfitReport.bind(this);
    this.updateRentPayment = this.updateRentPayment.bind(this);
    this.getRefundDue = this.getRefundDue.bind(this);
    this.settleRefund = this.settleRefund.bind(this);
    this.resendPaymentReceipt = this.resendPaymentReceipt.bind(this);
    this.listPaymentReceipts = this.listPaymentReceipts.bind(this);
  }

  async calculateMonthlyProfit(req, res) {
    try {
      const { houseId, month, year } = req.query;
      const userId = req.user.id;

      // Validate parameters
      const targetMonth = month ? parseInt(month) : new Date().getMonth() + 1;
      const targetYear = year ? parseInt(year) : new Date().getFullYear();
      const startDate = new Date(targetYear, targetMonth - 1, 1);
      const endDate = new Date(targetYear, targetMonth, 0);

      // Check permission
      if (req.user.role.slug !== "web_owner") {
        const hasAccess = await this.checkHouseAccess(userId, houseId);
        if (!hasAccess) {
          return res.status(403).json({
            success: false,
            error: "You do not have permission to view profit for this house",
          });
        }
      }

      // Get all income sources for the month
      const rentIncome = await db("rent_payment")
        .where("house_id", houseId)
        .andWhere("paid_date", ">=", startDate)
        .andWhere("paid_date", "<=", endDate)
        .andWhere("status", "paid")
        .sum("paid_amount as total")
        .first();

      const advanceIncome = await db("advance_payment")
        .where("house_id", houseId)
        .andWhere("payment_date", ">=", startDate)
        .andWhere("payment_date", "<=", endDate)
        .sum("paid_amount as total")
        .first();

      // Get all expenses for the month
      const expenses = await db("house_expense")
        .where("house_id", houseId)
        .andWhere("expense_date", ">=", startDate)
        .andWhere("expense_date", "<=", endDate)
        .andWhere("status", "approved")
        .select("category", "amount", "description");

      const totalExpenses = expenses.reduce(
        (sum, expense) => sum + parseFloat(expense.amount || 0),
        0
      );

      // Calculate profit
      const totalRentIncome = parseFloat(rentIncome?.total || 0);
      const totalAdvanceIncome = parseFloat(advanceIncome?.total || 0);
      const totalIncome = totalRentIncome + totalAdvanceIncome;
      const profit = totalIncome - totalExpenses;

      // Categorize expenses
      const expenseCategories = {};
      expenses.forEach((expense) => {
        const category = expense.category;
        if (!expenseCategories[category]) {
          expenseCategories[category] = {
            total: 0,
            items: [],
          };
        }
        expenseCategories[category].total += parseFloat(expense.amount || 0);
        expenseCategories[category].items.push({
          amount: expense.amount,
          description: expense.description,
        });
      });

      return res.json({
        success: true,
        data: {
          month: targetMonth,
          year: targetYear,
          period: `${targetYear}-${String(targetMonth).padStart(2, "0")}`,
          income: {
            rent: totalRentIncome,
            advance_payments: totalAdvanceIncome,
            total: totalIncome,
          },
          expenses: {
            total: totalExpenses,
            by_category: expenseCategories,
            items: expenses,
          },
          profit: {
            amount: profit,
            percentage: totalIncome > 0 ? (profit / totalIncome) * 100 : 0,
          },
        },
      });
    } catch (error) {
      console.error("Calculate monthly profit error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to calculate monthly profit",
      });
    }
  }

  // Get profit report for multiple months
  async getProfitReport(req, res) {
    try {
      const { houseId, startDate, endDate } = req.query;
      const userId = req.user.id;

      // Check permission
      if (req.user.role.slug !== "web_owner") {
        const hasAccess = await this.checkHouseAccess(userId, houseId);
        if (!hasAccess) {
          return res.status(403).json({
            success: false,
            error: "You do not have permission to view profit report",
          });
        }
      }

      const start = startDate
        ? new Date(startDate)
        : new Date(new Date().getFullYear(), 0, 1);
      const end = endDate ? new Date(endDate) : new Date();

      // Get monthly breakdown
      const monthlyData = await db.raw(
        `
        SELECT 
            months.month,
            COALESCE(rp.total_rent, 0) as rent_income,
            COALESCE(ap.total_advance, 0) as advance_income,
            COALESCE(he.total_expenses, 0) as expenses
        FROM (
            -- Get unique list of months first
            SELECT DISTINCT DATE_FORMAT(paid_date, '%Y-%m') as month FROM rent_payment WHERE house_id = ? AND paid_date BETWEEN ? AND ?
            UNION
            SELECT DISTINCT DATE_FORMAT(payment_date, '%Y-%m') as month FROM advance_payment WHERE house_id = ? AND payment_date BETWEEN ? AND ?
            UNION
            SELECT DISTINCT DATE_FORMAT(expense_date, '%Y-%m') as month FROM house_expense WHERE house_id = ? AND expense_date BETWEEN ? AND ? AND status = 'approved'
        ) months
        LEFT JOIN (
            SELECT DATE_FORMAT(paid_date, '%Y-%m') as month, SUM(paid_amount) as total_rent
            FROM rent_payment 
            WHERE house_id = ? AND status = 'paid'
            GROUP BY month
        ) rp ON rp.month = months.month
        LEFT JOIN (
            SELECT DATE_FORMAT(payment_date, '%Y-%m') as month, SUM(paid_amount) as total_advance
            FROM advance_payment 
            WHERE house_id = ?
            GROUP BY month
        ) ap ON ap.month = months.month
        LEFT JOIN (
            SELECT DATE_FORMAT(expense_date, '%Y-%m') as month, SUM(amount) as total_expenses
            FROM house_expense 
            WHERE house_id = ? AND status = 'approved'
            GROUP BY month
        ) he ON he.month = months.month
        ORDER BY months.month`,
        [
          houseId,
          start,
          end,
          houseId,
          start,
          end,
          houseId,
          start,
          end,
          houseId,
          houseId,
          houseId,
        ]
      );

      const report = monthlyData[0].map((row) => ({
        month: row.month,
        rent_income: parseFloat(row.rent_income || 0),
        advance_income: parseFloat(row.advance_income || 0),
        total_income:
          parseFloat(row.rent_income || 0) +
          parseFloat(row.advance_income || 0),
        expenses: parseFloat(row.expenses || 0),
        profit:
          parseFloat(row.rent_income || 0) +
          parseFloat(row.advance_income || 0) -
          parseFloat(row.expenses || 0),
      }));

      // Calculate totals
      const totals = report.reduce(
        (acc, row) => ({
          rent_income: acc.rent_income + row.rent_income,
          advance_income: acc.advance_income + row.advance_income,
          total_income: acc.total_income + row.total_income,
          expenses: acc.expenses + row.expenses,
          profit: acc.profit + row.profit,
        }),
        {
          rent_income: 0,
          advance_income: 0,
          total_income: 0,
          expenses: 0,
          profit: 0,
        }
      );

      return res.json({
        success: true,
        data: {
          period: {
            start: start.toISOString().split("T")[0],
            end: end.toISOString().split("T")[0],
          },
          monthly_breakdown: report,
          totals: totals,
        },
      });
    } catch (error) {
      console.error("Get profit report error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to generate profit report",
      });
    }
  }
  // Helper: get for_month string YYYY-MM from a Date
  getForMonth(date) {
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) return null;
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    return `${y}-${String(m).padStart(2, "0")}`;
  }

  // 1. Record rent payment (manual by house owner + need to ensure that caretaker has permission)
  async recordRentPayment(req, res) {
    try {
      const {
        payment_method,
        paid_amount, // Cash amount received (or base rent from frontend when doing full payment)
        transaction_id,
        notes,
        paid_date,
        calculate_next_payment,
        amenities = [],
        base_rent,
        amenities_total,
        late_fee,
        status = "pending", // Default to pending if not provided
        use_advance_payment = false,
        renter_paid_remaining, // Optional: additional cash from renter (e.g. when closing month after applying advance)
        for_month, // Optional: specific month to create due for (YYYY-MM format)
        for_year, // Optional: specific year
      } = req.body;

      const userId = req.user.id;
      const { id: flat_id } = req.params;

      // Get flat with renter and house info
      const flat = await db("flat")
        .join("house", "flat.house_id", "house.id")
        .leftJoin("renter", "flat.renter_id", "renter.id")
        .where("flat.id", flat_id)
        .select(
          "flat.*",
          "house.ownerId",
          "house.name as houseName",
          "house.metadata as houseMetadata",
          "renter.name as renterName",
          "renter.email as renterEmail",
          "renter.phone as renterPhone",
          "renter.nid as renterNid"
        )
        .first();

      if (!flat) {
        return res.status(404).json({
          success: false,
          error: "Flat not found",
        });
      }

      // Parse flat metadata to get current amenities
      let flatMetadata = {};
      try {
        flatMetadata =
          flat.metadata && typeof flat.metadata === "string"
            ? JSON.parse(flat.metadata)
            : flatMetadata || {};
      } catch (e) {
        console.error("Failed to parse flat metadata:", e);
        flatMetadata = {};
      }

      // Use provided amenities or fall back to flat metadata amenities
      let paymentAmenities = [];
      if (amenities && amenities.length > 0) {
        // Use amenities from request (customized for this payment)
        paymentAmenities = amenities.map((amenity) => ({
          name: amenity.name || "",
          charge: parseFloat(amenity.charge) || 0,
        }));
      } else if (flatMetadata.amenities && flatMetadata.amenities.length > 0) {
        // Use flat's default amenities
        paymentAmenities = flatMetadata.amenities.map((amenity) => ({
          name: amenity.name || "",
          charge: parseFloat(amenity.charge) || 0,
        }));
      }

      // Calculate amenities total
      const amenitiesTotal = paymentAmenities.reduce(
        (sum, item) => sum + (parseFloat(item.charge) || 0),
        0
      );

      let hasAccess = false;

      const currentUser = req.user;
      // Check permission
      if (currentUser.role.slug === "web_owner") {
        hasAccess = true;
      } else if (currentUser.role.slug === "house_owner") {
        // House owner can only record payments for their own houses
        hasAccess = flat.ownerId === currentUser.id;
      } else if (currentUser.role.slug === "staff") {
        // Staff needs payments.create permission
        const hasPermission = await permissionService.hasPermission(
          currentUser.id,
          "payments.create"
        );
        hasAccess = hasPermission;
      } else if (currentUser.role.slug === "caretaker") {
        // Caretaker needs payments.create permission for this specific house
        hasAccess = await CaretakerPermissionService.hasCaretakerPermission(
          currentUser.id,
          flat.house_id,
          "payments.create"
        );
      }

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          error: "You do not have permission to record payments for this house",
        });
      }

      // Get the current pending rent payment
      const currentPayment = await db("rent_payment")
        .where("flat_id", flat_id)
        .andWhere("status", "in", ["pending", "overdue"])
        .orderBy("due_date", "asc")
        .first();

      const actualPaidDate = paid_date ? new Date(paid_date) : new Date();
      const today = new Date();

      // Calculate base rent amount
      const baseRentAmount = parseFloat(
        base_rent ||
          paid_amount ||
          (currentPayment ? currentPayment.base_amount : null) ||
          flat.rent_amount ||
          0
      );

      // Calculate due date if we need to create a new payment
      let dueDate = null;
      if (!currentPayment && status === "pending") {
        // Calculate due date based on flat's should_pay_rent_day
        const dayOfMonth = flat.should_pay_rent_day || 10;
        
        // Determine which month/year to create the due for
        let targetYear, targetMonth;
        
        if (for_month && for_year) {
          dueDate = new Date(parseInt(for_year), parseInt(for_month) - 1, dayOfMonth);
        } else if (for_month) {
          dueDate = new Date(today.getFullYear(), parseInt(for_month) - 1, dayOfMonth);
        } else if (paid_date) {
          // Use paid_date as intended due date when creating pending (e.g. paid_date: "2026-05-08" => May due)
          const d = new Date(paid_date);
          if (!isNaN(d.getTime())) {
            dueDate = new Date(d.getFullYear(), d.getMonth(), dayOfMonth);
          }
        }

        // Default: first month without a record (next gap after latest existing)
        if (!dueDate || isNaN(dueDate.getTime())) {
          const latestForMonth = await db("rent_payment")
            .where("flat_id", flat_id)
            .whereNotNull("for_month")
            .orderBy("for_month", "desc")
            .select("for_month")
            .first();

          if (latestForMonth && latestForMonth.for_month) {
            const [y, m] = latestForMonth.for_month.split("-").map(Number);
            const nextMonth = m === 12 ? { year: y + 1, month: 1 } : { year: y, month: m + 1 };
            dueDate = new Date(nextMonth.year, nextMonth.month - 1, dayOfMonth);
          } else {
            // No existing records: use next month from today
            let targetYear = today.getFullYear();
            let targetMonth = today.getMonth();
            dueDate = new Date(targetYear, targetMonth, dayOfMonth);
            if (dueDate <= today) {
              targetMonth += 1;
              if (targetMonth > 11) {
                targetMonth = 0;
                targetYear += 1;
              }
              dueDate = new Date(targetYear, targetMonth, dayOfMonth);
            }
          }
        }

        // One record per flat per month: check by for_month (YYYY-MM)
        if (dueDate) {
          const forMonthStr = this.getForMonth(dueDate);
          const existingForMonth = await db("rent_payment")
            .where("flat_id", flat_id)
            .andWhere("for_month", forMonthStr)
            .first();

          if (existingForMonth) {
            return res.status(400).json({
              success: false,
              error: `This flat already has a rent record for ${forMonthStr}. One record per month per flat.`,
            });
          }
        }
      }

      let calculatedLateFee = parseFloat(late_fee) || 0;

      // If creating a new pending payment, don't calculate late fee
      if (currentPayment && calculatedLateFee === 0 && actualPaidDate > currentPayment.due_date) {
        const daysLate = Math.ceil(
          (actualPaidDate - currentPayment.due_date) / (1000 * 60 * 60 * 24)
        );
        const dailyLateFee =
          (baseRentAmount * (flat.late_fee_percentage || 5)) / 100 / 30;
        calculatedLateFee = Math.round(dailyLateFee * daysLate * 100) / 100;
      }

      // Calculate total amount
      const totalAmount = baseRentAmount + amenitiesTotal + calculatedLateFee;

      // Fetch available advance (read-only; no mutation yet)
      let advancePaymentUsed = null;
      let availableAdvance = null;
      if (use_advance_payment && currentPayment) {
        availableAdvance = await db("advance_payment")
          .where("flat_id", flat_id)
          .andWhere("renter_id", currentPayment.renter_id)
          .andWhere("remaining_amount", ">", 0)
          .orderBy("payment_date", "asc")
          .first();

        if (availableAdvance) {
          const remainingDue = totalAmount - (parseFloat(currentPayment.paid_amount) || 0);
          const useAmount = Math.min(
            parseFloat(availableAdvance.remaining_amount),
            remainingDue,
            totalAmount
          );
          const newRemaining = parseFloat(availableAdvance.remaining_amount) - useAmount;
          advancePaymentUsed = {
            advance_payment_id: availableAdvance.id,
            amount: useAmount,
            remaining: newRemaining,
          };
        }
      }

      const advanceUsedThisCall = advancePaymentUsed ? advancePaymentUsed.amount : 0;

      // cashFromRenter: when renter_paid_remaining is set = additive cash. Else paid_amount = TOTAL for this payment.
      // When use_advance and we used advance: paid_amount means total, so cash = total - advance (avoid double count).
      let cashFromRenter;
      if (renter_paid_remaining != null && renter_paid_remaining !== "") {
        cashFromRenter = parseFloat(renter_paid_remaining);
      } else if (use_advance_payment && advancePaymentUsed) {
        // paid_amount from body = total for this payment; cash = total - advance used
        const totalThisPayment = parseFloat(paid_amount) || totalAmount;
        cashFromRenter = Math.max(0, totalThisPayment - advanceUsedThisCall);
      } else {
        cashFromRenter = parseFloat(paid_amount) || totalAmount;
      }

      // Total paid for this month = existing + advance used this call + cash from renter
      const existingPaid = currentPayment ? (parseFloat(currentPayment.paid_amount) || 0) : 0;
      const totalPaidForMonth = existingPaid + advanceUsedThisCall + (Number.isFinite(cashFromRenter) ? cashFromRenter : 0);

      // Expected total for the period (base + amenities + late fee)
      const expectedTotal = totalAmount;

      // Handle status logic (based on total paid for month vs expected)
      let finalStatus = status;
      if (currentPayment) {
        // Only adjust status if we're actually recording a payment (not creating a pending due)
        if (finalStatus !== "pending") {
          if (totalPaidForMonth >= expectedTotal) {
            finalStatus = "paid";
          } else if (totalPaidForMonth > 0) {
            finalStatus = "partial";
          } else {
            finalStatus = "pending";
          }
        }
      }

      // Prepare payment metadata
      const paymentMetadata = {
        amenities: paymentAmenities,
        amenitiesTotal: amenitiesTotal,
        lateFee: calculatedLateFee,
        baseRent: baseRentAmount,
        advancePaymentUsed: advancePaymentUsed,
        renterDetails: {
          name: flat.renterName,
          nid: flat.renterNid,
        },
        houseName: flat.houseName,
        flatNumber: flat.number,
        paymentType: amenities.length > 0 ? "customized" : "standard",
        statusDetermination: {
          totalPaid: currentPayment ? totalPaidForMonth : totalAmount,
          renter_paid_remaining: renter_paid_remaining != null ? parseFloat(renter_paid_remaining) : undefined,
          calculationMethod: currentPayment ?
            (currentPayment.base_amount !== null ? "breakdown" : "simple") :
            "new_pending_due",
          dueMonth: dueDate ? this.getForMonth(dueDate) : null,
        },
      };

      // Start transaction (advance_payment update must be inside so rollback undoes it on failure)
      const trx = await db.transaction();

      try {
        // Update advance_payment inside transaction - if rent_payment fails, this rolls back too
        if (advancePaymentUsed && availableAdvance) {
          await trx("advance_payment")
            .where("id", availableAdvance.id)
            .update({
              remaining_amount: advancePaymentUsed.remaining,
              status: advancePaymentUsed.remaining > 0 ? "partially_used" : "fully_used",
              updated_at: new Date(),
            });
        }

        let paymentId;

        if (currentPayment) {
          // Update existing payment (paid_amount = total for month: existing + advance + renter_paid_remaining)
          const updatePayload = {
            paid_date: finalStatus === "pending" ? null : actualPaidDate,
            paid_amount: finalStatus === "pending" ? 0 : totalPaidForMonth,
            base_amount: baseRentAmount,
            amenities_charge: amenitiesTotal,
            payment_method,
            transaction_id,
            late_fee_amount: calculatedLateFee,
            status: finalStatus,
            notes,
            metadata: JSON.stringify(paymentMetadata),
            updated_at: new Date(),
          };
          if (currentPayment.for_month == null && currentPayment.due_date) {
            updatePayload.for_month = this.getForMonth(new Date(currentPayment.due_date));
          }
          await trx("rent_payment").where("id", currentPayment.id).update(updatePayload);
          paymentId = currentPayment.id;
        } else if (status === "pending") {
          // Create new pending due
          
          // Validate we have a renter for the flat
          if (!flat.renter_id) {
            await trx.rollback();
            return res.status(400).json({
              success: false,
              error: "Cannot create a pending due: No renter assigned to this flat",
            });
          }

          const forMonthStr = this.getForMonth(dueDate);
          const newPayment = {
            uuid: uuidv4(),
            flat_id,
            renter_id: flat.renter_id,
            house_id: flat.house_id,
            amount: totalAmount,
            due_date: dueDate,
            for_month: forMonthStr,
            paid_date: null,
            paid_amount: 0,
            base_amount: baseRentAmount,
            amenities_charge: amenitiesTotal,
            payment_method: null,
            transaction_id: null,
            status: "pending",
            late_fee_amount: 0,
            notes,
            metadata: JSON.stringify(paymentMetadata),
            created_by: userId,
            created_at: new Date(),
            updated_at: new Date(),
          };

          const [newId] = await trx("rent_payment").insert(newPayment);
          paymentId = newId;
          
          // Update flat's rent due date
          await trx("flat").where("id", flat_id).update({
            rent_due_date: dueDate,
            next_payment_date: dueDate,
            updatedAt: new Date(),
          });
        }

        // Update flat's last rent paid date only if payment is not pending
        if (finalStatus !== "pending") {
          await trx("flat").where("id", flat_id).update({
            last_rent_paid_date: actualPaidDate,
            updatedAt: new Date(),
          });
        }

        let nextDueDate = null;

        // Calculate next due date only if we're recording a payment (not creating pending due)
        // AND only if calculate_next_payment is true
        if (currentPayment && finalStatus !== "pending" && 
            String(calculate_next_payment) === "true") {
          nextDueDate = await this.calculateNextDueDate(
            actualPaidDate,
            flat.should_pay_rent_day
          );

          // Get flat metadata for next payment
          let nextPaymentAmenities = [];
          if (flatMetadata.amenities && flatMetadata.amenities.length > 0) {
            nextPaymentAmenities = flatMetadata.amenities.map((amenity) => ({
              name: amenity.name || "",
              charge: parseFloat(amenity.charge) || 0,
            }));
          }

          const nextAmenitiesTotal = nextPaymentAmenities.reduce(
            (sum, item) => sum + (parseFloat(item.charge) || 0),
            0
          );

          const nextPaymentTotal = baseRentAmount + nextAmenitiesTotal;
          const nextForMonth = this.getForMonth(nextDueDate);
          const existingNext = await trx("rent_payment")
            .where("flat_id", flat_id)
            .andWhere("for_month", nextForMonth)
            .first();
          if (existingNext) {
            await trx.rollback();
            return res.status(400).json({
              success: false,
              error: `Next month (${nextForMonth}) already has a rent record for this flat.`,
            });
          }

          const nextPayment = {
            uuid: uuidv4(),
            flat_id,
            renter_id: flat.renter_id,
            house_id: flat.house_id,
            amount: nextPaymentTotal,
            base_amount: baseRentAmount,
            amenities_charge: nextAmenitiesTotal,
            for_month: nextForMonth,
            metadata: JSON.stringify({
              amenities: nextPaymentAmenities,
              breakdown: {
                base_rent: baseRentAmount,
                amenities_charge: nextAmenitiesTotal,
                total: nextPaymentTotal,
              },
            }),
            due_date: nextDueDate,
            status: "pending",
            created_at: new Date(),
            updated_at: new Date(),
          };

          await trx("rent_payment").insert(nextPayment);

          // Update flat with next due date
          await trx("flat").where("id", flat_id).update({
            rent_due_date: nextDueDate,
          });
        }

        await trx.commit();

        // Send receipt notification only for non-pending payments
        if ((flat.renterEmail || flat.renterPhone) && finalStatus !== "pending") {
          try {
            await NotificationService.sendPaymentReceipt({
              renterName: flat.renterName,
              email: flat.renterEmail,
              phone: flat.renterPhone,
              amount: totalAmount,
              paymentDate: actualPaidDate,
              flatNumber: flat.number,
              houseName: flat.houseName,
              transactionId: transaction_id,
              table_name: 'rent_payment',
              row_id: paymentId,
              breakdown: {
                baseRent: baseRentAmount,
                amenities: amenitiesTotal,
                lateFee: calculatedLateFee,
              },
              status: finalStatus,
            });
          } catch (notificationError) {
            console.error("Failed to send notification:", notificationError);
          }
        }

        return res.json({
          success: true,
          data: {
            paymentId,
            baseRent: baseRentAmount,
            amenitiesTotal,
            lateFee: calculatedLateFee,
            totalAmount,
            totalPaidForMonth: currentPayment ? totalPaidForMonth : 0,
            renter_paid_remaining: renter_paid_remaining != null ? parseFloat(renter_paid_remaining) : undefined,
            status: finalStatus,
            nextDueDate,
            dueDate: dueDate || (currentPayment ? currentPayment.due_date : null),
            for_month: dueDate ? this.getForMonth(dueDate) : (currentPayment && currentPayment.due_date ? this.getForMonth(new Date(currentPayment.due_date)) : null),
            metadata: paymentMetadata,
            action: currentPayment ? "payment_recorded" : "pending_due_created",
          },
          message: currentPayment ? 
            "Payment recorded successfully" : 
            "Pending due created successfully",
        });
      } catch (error) {
        await trx.rollback();
        throw error;
      }
    } catch (error) {
      console.error("Record rent payment error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to process rent payment",
      });
    }
  }

  // 1.1 Update rent payment
  async updateRentPayment(req, res) {
    try {
      const { id } = req.params;
      const {
        paid_amount,
        payment_method,
        transaction_id,
        notes,
        paid_date,
        status // Allow manual status override if needed, though we auto-calc
      } = req.body;

      const userId = req.user.id;

      // Get payment details with house info for permission check
      const payment = await db("rent_payment")
        .join("flat", "rent_payment.flat_id", "flat.id")
        .join("house", "flat.house_id", "house.id")
        .where("rent_payment.id", id)
        .select(
          "rent_payment.*",
          "house.id as houseId",
          "house.ownerId"
        )
        .first();

      if (!payment) {
        return res.status(404).json({
          success: false,
          error: "Rent payment record not found",
        });
      }

      // Check permission
      let hasAccess = false;
      const currentUser = req.user;

      if (currentUser.role.slug === "web_owner") {
        hasAccess = true;
      } else if (currentUser.role.slug === "house_owner") {
        hasAccess = payment.ownerId === currentUser.id;
      } else if (currentUser.role.slug === "staff") {
        hasAccess = await permissionService.hasPermission(currentUser.id, "payments.update");
      } else if (currentUser.role.slug === "caretaker") {
        hasAccess = await CaretakerPermissionService.hasCaretakerPermission(
          currentUser.id,
          payment.houseId,
          "payments.update" // Ensure this permission exists or use payments.create
        );
      }

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          error: "You do not have permission to update payments for this house",
        });
      }

      const updateData = {
        updated_at: new Date()
      };

      if (payment_method !== undefined) updateData.payment_method = payment_method;
      if (transaction_id !== undefined) updateData.transaction_id = transaction_id;
      if (notes !== undefined) updateData.notes = notes;
      if (paid_date !== undefined) updateData.paid_date = new Date(paid_date);

      // Handle amount and status update
      if (paid_amount !== undefined) {
        const newPaidAmount = parseFloat(paid_amount);
        updateData.paid_amount = newPaidAmount;

        // Auto-calculate status if not explicitly provided
        if (!status) {
          const totalDue = parseFloat(payment.amount);
          if (newPaidAmount >= totalDue) {
            updateData.status = "paid";
          } else if (newPaidAmount > 0) {
            updateData.status = "partial";
          } else {
            updateData.status = "pending";
          }
        }
      }

      if (status !== undefined) {
        updateData.status = status;
      }

      await db("rent_payment").where("id", id).update(updateData);

      // Fetch updated record
      const updatedPayment = await db("rent_payment").where("id", id).first();

      return res.json({
        success: true,
        message: "Rent payment updated successfully",
        data: serializeBigInt(updatedPayment) // Ensure serializeBigInt is available or handle BigInts
      });

    } catch (error) {
      console.error("Update rent payment error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to update rent payment",
      });
    }
  }

  // GET: List renters that the house owner needs to refund (remaining advance at removal)
  async getRefundDue(req, res) {
    try {
      const userId = req.user.id;
      const { house_id: houseIdParam } = req.query;

      let houseIds = [];
      if (req.user.role.slug === "web_owner") {
        const allHouses = await db("house").select("id");
        houseIds = allHouses.map((h) => h.id);
      } else if (req.user.role.slug === "house_owner") {
        houseIds = await db("house").where("ownerId", userId).pluck("id");
      } else if (req.user.role.slug === "staff") {
        const hasPermission = await permissionService.hasPermission(userId, "payments.read");
        if (!hasPermission) {
          return res.status(403).json({ success: false, error: "No permission" });
        }
        houseIds = await db("house").pluck("id");
      } else if (req.user.role.slug === "caretaker") {
        const assigned = await db("caretakerassignment")
          .where("caretakerId", userId)
          .andWhere("expiresAt", ">", new Date())
          .pluck("houseId");
        houseIds = assigned;
      }

      if (houseIds.length === 0) {
        return res.json({ success: true, data: [] });
      }

      if (houseIdParam) {
        const hId = parseInt(houseIdParam);
        if (!houseIds.includes(hId)) {
          return res.status(403).json({ success: false, error: "Unauthorized house access" });
        }
        houseIds = [hId];
      }

      const renters = await db("renter").select("id", "name", "phone", "email", "metadata");
      const list = [];

      for (const renter of renters) {
        let meta = {};
        try {
          meta = renter.metadata && typeof renter.metadata === "string"
            ? JSON.parse(renter.metadata)
            : renter.metadata || {};
        } catch (e) {
          continue;
        }
        const refundDue = meta.refund_due;
        if (!Array.isArray(refundDue) || refundDue.length === 0) continue;

        const unsettled = refundDue.filter(
          (e) => Number(e.amount) > 0 && houseIds.includes(Number(e.house_id))
        );
        if (unsettled.length === 0) continue;

        list.push({
          renter_id: renter.id,
          renter_name: renter.name,
          renter_phone: renter.phone,
          renter_email: renter.email,
          refund_due: unsettled.map((e) => ({
            amount: parseFloat(e.amount),
            flat_id: e.flat_id,
            house_id: e.house_id,
            flat_name: e.flat_name,
            house_name: e.house_name,
            removed_at: e.removed_at,
            settled_at: e.settled_at,
          })),
          total_refund_due: unsettled.reduce((s, e) => s + parseFloat(e.amount || 0), 0),
        });
      }

      return res.json({ success: true, data: list });
    } catch (error) {
      console.error("Get refund due error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to get refund due list",
      });
    }
  }

  // POST: Mark refund as settled (house owner refunded the renter; set amount to 0)
  async settleRefund(req, res) {
    try {
      const userId = req.user.id;
      const { renter_id, flat_id, house_id, notes } = req.body;

      if (!renter_id || !flat_id || !house_id) {
        return res.status(400).json({
          success: false,
          error: "renter_id, flat_id, and house_id are required",
        });
      }

      const house = await db("house").where("id", house_id).first();
      if (!house) {
        return res.status(404).json({ success: false, error: "House not found" });
      }

      if (req.user.role.slug !== "web_owner" && req.user.role.slug !== "staff") {
        if (house.ownerId !== userId) {
          return res.status(403).json({ success: false, error: "Not your house" });
        }
      }

      const renter = await db("renter").where("id", renter_id).first();
      if (!renter) {
        return res.status(404).json({ success: false, error: "Renter not found" });
      }

      let meta = {};
      try {
        meta = renter.metadata && typeof renter.metadata === "string"
          ? JSON.parse(renter.metadata)
          : renter.metadata || {};
      } catch (e) {
        meta = {};
      }

      const refundDue = Array.isArray(meta.refund_due) ? meta.refund_due : [];
      const index = refundDue.findIndex(
        (e) => Number(e.flat_id) === Number(flat_id) && Number(e.house_id) === Number(house_id) && Number(e.amount) > 0
      );

      if (index === -1) {
        return res.status(400).json({
          success: false,
          error: "No unsettled refund due for this renter/flat/house",
        });
      }

      refundDue[index] = {
        ...refundDue[index],
        amount: 0,
        settled_at: new Date().toISOString(),
        settled_by: userId,
        notes: notes || refundDue[index].notes,
      };
      meta.refund_due = refundDue;

      await db("renter")
        .where("id", renter_id)
        .update({
          metadata: JSON.stringify(meta),
          updatedAt: new Date(),
        });

      return res.json({
        success: true,
        message: "Refund marked as settled",
        data: {
          renter_id,
          flat_id,
          house_id,
          settled_at: refundDue[index].settled_at,
        },
      });
    } catch (error) {
      console.error("Settle refund error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to settle refund",
      });
    }
  }

  calculateNextDueDate(currentDate, dayOfMonth) {
      // Ensure dayOfMonth is a valid number, default to current day if missing
      const day = parseInt(dayOfMonth) || currentDate.getDate();
      
      const nextMonth = new Date(currentDate);
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      nextMonth.setDate(day);

      // Check if the date is valid
      if (isNaN(nextMonth.getTime())) {
          return new Date(); // Fallback to now if calculation fails
      }

      return nextMonth; 
  }
  // 2. Generate monthly rent invoices
  async generateRentInvoices(req, res) {
    try {
      const { house_id, month } = req.body;
      const userId = req.user.id;

      // Check permission
      if (req.user.role.slug === "caretaker") {
        const hasAccess = await this.checkHouseAccess(userId, house_id);
        if (!hasAccess) {
          return res.status(403).json({
            success: false,
            error:
              "You do not have permission to generate invoices for this house",
          });
        }
      }

      // Get all flats with active renters in the house
      const flats = await db("flat")
        .where("house_id", house_id)
        .andWhere("renter_id", "!=", null)
        .select(
          "id",
          "renter_id",
          "rent_amount",
          "should_pay_rent_day",
          "number"
        );

      if (flats.length === 0) {
        return res.status(400).json({
          success: false,
          error: "No flats with active renters found in this house",
        });
      }

      const targetMonth = month ? new Date(month) : new Date();
      targetMonth.setMonth(targetMonth.getMonth() + 1); // Next month

      const invoices = [];
      const errors = [];

      for (const flat of flats) {
        try {
          // Calculate due date for next month
          const dueDate = new Date(
            targetMonth.getFullYear(),
            targetMonth.getMonth(),
            flat.should_pay_rent_day
          );

          const forMonthStr = this.getForMonth(dueDate);
          const existingInvoice = await db("rent_payment")
            .where("flat_id", flat.id)
            .andWhere("for_month", forMonthStr)
            .first();

          if (existingInvoice) {
            errors.push(
              `Invoice already exists for flat ${flat.number} for ${forMonthStr}`
            );
            continue;
          }

          // Create rent payment record (one per flat per month)
          const rentPayment = {
            uuid: uuidv4(),
            flat_id: flat.id,
            renter_id: flat.renter_id,
            house_id,
            amount: flat.rent_amount || 0,
            due_date,
            for_month: forMonthStr,
            status: "pending",
            created_at: new Date(),
            updated_at: new Date(),
          };

          const [paymentId] = await db("rent_payment").insert(rentPayment);

          invoices.push({
            flatId: flat.id,
            flatNumber: flat.number,
            amount: flat.rent_amount,
            dueDate,
            paymentId,
          });
        } catch (error) {
          errors.push(
            `Failed to create invoice for flat ${flat.number}: ${error.message}`
          );
        }
      }

      return res.json({
        success: true,
        data: {
          generated: invoices.length,
          invoices,
          errors: errors.length > 0 ? errors : undefined,
        },
        message: `Generated ${invoices.length} rent invoices`,
      });
    } catch (error) {
      console.error("Generate rent invoices error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to generate rent invoices",
      });
    }
  }

  // 3. Record house expense
  async recordExpense(req, res) {
    try {
      const {
        house_id,
        category,
        amount,
        description,
        expense_date,
        payment_method,
        receipt_url,
      } = req.body;
      const userId = req.user.id;

      // Get house
      const house = await db("house").where("id", house_id).first();
      if (!house) {
        return res.status(404).json({
          success: false,
          error: "House not found",
        });
      }

      // Check permission
      if (req.user.role.slug !== "web_owner") {
        const hasAccess = await this.checkHouseAccess(userId, house_id);
        if (!hasAccess) {
          return res.status(403).json({
            success: false,
            error:
              "You do not have permission to record expenses for this house",
          });
        }
      }

      // For web_owner, expenses need approval from house owner
      let status = "pending";
      if (req.user.role.slug === "web_owner") {
        status = "pending";
      } else if (
        req.user.role.slug === "house_owner" &&
        house.ownerId === userId
      ) {
        status = "approved";
      } else {
        status = "pending";
      }

      const expense = {
        uuid: uuidv4(),
        house_id,
        category,
        amount,
        description,
        expense_date: expense_date ? new Date(expense_date) : new Date(),
        paid_by: userId,
        payment_method,
        receipt_url,
        status,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const [expenseId] = await db("house_expense").insert(expense);

      // Send approval request if needed
      if (status === "pending" && req.user.role.slug === "web_owner") {
        try {
          await NotificationService.sendExpenseApprovalRequest({
            houseId: house_id,
            houseName: house.name,
            amount,
            category,
            description,
            expenseId: expenseId,
            requestedBy: req.user.name,
          });
        } catch (notificationError) {
          console.error("Failed to send approval request:", notificationError);
        }
      }

      return res.status(201).json({
        success: true,
        data: {
          id: expenseId,
          ...expense,
        },
        message: "Expense recorded successfully",
      });
    } catch (error) {
      console.error("Record expense error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to record expense",
      });
    }
  }

  // 4. Record app fee payment (A house owner pays app fee to web owner [this platform])
  async recordAppFeePayment(req, res) {
    try {
      const {
        house_owner_id,
        house_id,
        amount,
        fee_type,
        due_date,
        payment_method,
        transaction_id,
      } = req.body;
      const userId = req.user.id;
      
      if (
        req.user.role.slug === "caretaker" ||
        req.user.role.slug === "house_owner"
      ) {
        return res.status(403).json({
          success: false,
          error: "Only web owner can record app fee payments",
        });
      }

      // Get house and owner
      const house = await db("house").where("id", house_id).first();
      if (!house) {
        return res.status(404).json({
          success: false,
          error: "House not found",
        });
      }

      const houseOwner = await db("user").where("id", house_owner_id).first();
      if (!houseOwner) {
        return res.status(404).json({
          success: false,
          error: "House owner not found",
        });
      }

      const feePayment = {
        uuid: uuidv4(),
        house_owner_id,
        house_id,
        amount,
        fee_type,
        due_date: due_date ? new Date(due_date) : new Date(),
        paid_date: new Date(),
        payment_method,
        transaction_id,
        status: "paid",
        created_at: new Date(),
        updated_at: new Date(),
      };

      const [paymentId] = await db("app_fee_payment").insert(feePayment);

      // Send notification to house owner
      try {
        await NotificationService.sendAppFeeReceipt({
          houseOwnerEmail: houseOwner.email,
          houseOwnerName: houseOwner.name,
          houseName: house.name,
          amount,
          feeType: fee_type,
          paymentDate: new Date(),
          transactionId: transaction_id,
        });
      } catch (notificationError) {
        console.error("Failed to send notification:", notificationError);
      }

      return res.status(201).json({
        success: true,
        data: {
          id: paymentId,
          ...feePayment,
        },
        message: "App fee payment recorded successfully",
      });
    } catch (error) {
      console.error("Record app fee payment error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to record app fee payment",
      });
    }
  }

  // 5. Get financial dashboard
  async getFinancialDashboard(req, res) {
    try {
      const { houseId, startDate, endDate } = req.query;
      const userId = req.user.id;
      const userRole = req.user.role.slug;

      let houseIds = [];
      let houseDetails = {};

      // Check permissions based on role
      if (userRole === "staff") {
        // Staff needs reports.view permission
        const hasPermission = await permissionService.hasPermission(
          userId,
          "reports.view"
        );
        if (!hasPermission) {
          return res.status(403).json({
            success: false,
            error: "You do not have permission to view financial reports",
          });
        }
      }

      // Get accessible houses based on role
      if (houseId) {
        // Check access for specific house
        if (userRole !== "web_owner") {
          const hasAccess = await this.checkHouseAccess(userId, houseId);
          if (!hasAccess) {
            return res.status(403).json({
              success: false,
              error:
                "You do not have permission to view this house's financial data",
            });
          }
        }
        houseIds = [houseId];

        // Get house name
        const house = await db("house")
          .where("id", houseId)
          .select("id", "name")
          .first();
        if (house) {
          houseDetails[houseId] = { name: house.name };
        }
      } else {
        // Get all accessible houses
        if (userRole === "web_owner") {
          // Web owner can see all houses
          const houses = await db("house").select("id", "name");
          houseIds = houses.map((h) => h.id);
          houses.forEach((house) => {
            houseDetails[house.id] = { name: house.name };
          });
        } else if (userRole === "house_owner") {
          // House owner can see their own houses
          const houses = await db("house")
            .where("ownerId", userId)
            .select("id", "name");
          houseIds = houses.map((h) => h.id);
          houses.forEach((house) => {
            houseDetails[house.id] = { name: house.name };
          });
        } else if (userRole === "staff") {
          const hasPerm = await permissionService.hasPermission(
            userId,
            "reports.view"
          );
          if (!hasPerm) {
            return res.status(403).json({
              success: false,
              error: "You do not have permission to view financial reports",
            });
          }
        } else if (userRole === "caretaker") {
          // Caretaker can see houses they're assigned to with reports.view permission
          const allCaretakerHouses =
            await CaretakerPermissionService.getCaretakerHouses(userId);

          // Check which houses the caretaker has reports.view permission for
          for (const hId of allCaretakerHouses) {
            const hasPermission =
              await CaretakerPermissionService.hasCaretakerPermission(
                userId,
                hId,
                "reports.view"
              );
            if (hasPermission) {
              houseIds.push(hId);
            }
          }

          // Get names of accessible houses
          if (houseIds.length > 0) {
            const houses = await db("house")
              .whereIn("id", houseIds)
              .select("id", "name");
            houses.forEach((house) => {
              houseDetails[house.id] = { name: house.name };
            });
          }
        }
      }

      if (houseIds.length === 0) {
        return res.json({
          success: true,
          data: {
            overview: {
              totalRentDue: 0,
              totalRentCollected: 0,
              totalExpenses: 0,
              netIncome: 0,
              pendingPayments: 0,
              overduePayments: 0,
              monthlyExpenses: 0,
            },
            recentTransactions: [],
            upcomingPayments: [],
            chartData: {},
          },
        });
      }

      const dateFilter = {};
      if (startDate) dateFilter.startDate = new Date(startDate);
      if (endDate) dateFilter.endDate = new Date(endDate);

      // Get overview statistics with house names
      const overview = await this.getFinancialOverview(
        houseIds,
        dateFilter,
        houseDetails
      );

      // Get recent transactions with enhanced details
      const recentTransactions = await this.getRecentTransactions(
        houseIds,
        dateFilter,
        houseDetails
      );

      // Get upcoming payments with house and flat names
      const upcomingPayments = await this.getUpcomingPayments(
        houseIds,
        houseDetails
      );

      // Get chart data
      const chartData = await this.getChartData(houseIds, dateFilter);

      return res.json({
        success: true,
        data: {
          overview,
          recentTransactions,
          upcomingPayments,
          chartData,
          houseDetails,
        },
      });
    } catch (error) {
      console.error("Get financial dashboard error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch financial dashboard: " + error.message,
      });
    }
  }

  async getRecentTransactions(houseIds, dateFilter, houseDetails) {
    try {
      // Get current date for calculating date range if not provided
      const defaultEndDate = new Date();
      const defaultStartDate = new Date();
      defaultStartDate.setMonth(defaultStartDate.getMonth() - 1); // Last 30 days

      const start = dateFilter.startDate || defaultStartDate;
      const end = dateFilter.endDate || defaultEndDate;

      // Get rent payments with all details
      const rentPaymentsQuery = db("rent_payment as rp")
        .join("house as h", "rp.house_id", "h.id")
        .leftJoin("flat as f", "rp.flat_id", "f.id")
        .leftJoin("renter as r", "rp.renter_id", "r.id")
        .whereIn("rp.house_id", houseIds)
        .andWhereBetween("rp.created_at", [start, end])
        .select(
          "rp.*",
          "h.name as house_name",
          "f.number as flat_number",
          "f.name as flat_name",
          "r.name as renter_name",
          db.raw('"rent_payment" as transaction_type')
        );

      // Get expenses with house details
      const expensesQuery = db("house_expense as he")
        .join("house as h", "he.house_id", "h.id")
        .whereIn("he.house_id", houseIds)
        .andWhereBetween("he.created_at", [start, end])
        .andWhere("he.status", "approved")
        .select(
          "he.*",
          "h.name as house_name",
          db.raw('"expense" as transaction_type'),
          db.raw("NULL as flat_number"),
          db.raw("NULL as flat_name"),
          db.raw("NULL as renter_name")
        );

      // Get advance payments with details
      const advancePaymentsQuery = db("advance_payment as ap")
        .join("house as h", "ap.house_id", "h.id")
        .leftJoin("flat as f", "ap.flat_id", "f.id")
        .leftJoin("renter as r", "ap.renter_id", "r.id")
        .whereIn("ap.house_id", houseIds)
        .andWhereBetween("ap.created_at", [start, end])
        .select(
          "ap.*",
          "h.name as house_name",
          "f.number as flat_number",
          "f.name as flat_name",
          "r.name as renter_name",
          db.raw('"advance_payment" as transaction_type')
        );

      // Execute all queries in parallel
      const [rentPayments, expenses, advancePayments] = await Promise.all([
        rentPaymentsQuery.orderBy("rp.created_at", "desc").limit(15),
        expensesQuery.orderBy("he.created_at", "desc").limit(5),
        advancePaymentsQuery.orderBy("ap.created_at", "desc").limit(5),
      ]);

      // Combine all transactions
      const allTransactions = [...rentPayments, ...expenses, ...advancePayments]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 20);

      // Format transactions
      const formattedTransactions = allTransactions.map((tx) => {
        const baseTransaction = {
          id: tx.id,
          uuid: tx.uuid,
          house_id: tx.house_id,
          house_name: tx.house_name,
          type: tx.transaction_type,
          amount: parseFloat(tx.amount || 0),
          created_at: tx.created_at,
          status: tx.status,
          payment_method: tx.payment_method || null,
        };

        switch (tx.transaction_type) {
          case "rent_payment":
            return {
              ...baseTransaction,
              flat_id: tx.flat_id,
              flat_number: tx.flat_number,
              flat_name: tx.flat_name,
              renter_id: tx.renter_id,
              renter_name: tx.renter_name,
              paid_amount: parseFloat(tx.paid_amount || 0),
              paid_date: tx.paid_date,
              due_date: tx.due_date,
              transaction_id: tx.transaction_id,
              late_fee_amount: parseFloat(tx.late_fee_amount || 0),
              notes: tx.notes,
              base_amount: parseFloat(tx.base_amount || 0),
              amenities_charge: parseFloat(tx.amenities_charge || 0),
              created_by: tx.created_by,
              description: `Rent payment for ${
                tx.flat_name || `Flat ${tx.flat_number}`
              }`,
            };

          case "expense":
            return {
              ...baseTransaction,
              category: tx.category,
              description: tx.description || `${tx.category} expense`,
              expense_date: tx.expense_date,
              paid_by: tx.paid_by,
              receipt_url: tx.receipt_url,
              approved_by: tx.approved_by,
              metadata: tx.metadata,
            };

          case "advance_payment":
            return {
              ...baseTransaction,
              flat_id: tx.flat_id,
              flat_number: tx.flat_number,
              flat_name: tx.flat_name,
              renter_id: tx.renter_id,
              renter_name: tx.renter_name,
              paid_amount: parseFloat(tx.paid_amount || 0),
              remaining_amount: parseFloat(tx.remaining_amount || 0),
              payment_date: tx.payment_date,
              transaction_id: tx.transaction_id,
              notes: tx.notes,
              metadata: tx.metadata,
              description: `Advance payment for ${tx.renter_name || ""}`,
            };

          default:
            return baseTransaction;
        }
      });

      return formattedTransactions;
    } catch (error) {
      console.error("Error in getRecentTransactions:", error);
      throw new Error("Failed to fetch recent transactions: " + error.message);
    }
  }

  async getFinancialOverview(houseIds, dateFilter, houseDetails) {
    try {
      // Get current month for monthly calculations
      const currentDate = new Date();
      const currentMonth = currentDate.getMonth() + 1;
      const currentYear = currentDate.getFullYear();

      // Calculate start and end of current month
      const monthStart = new Date(currentYear, currentMonth - 1, 1);
      const monthEnd = new Date(currentYear, currentMonth, 0);

      // Total rent due (sum of all pending/overdue rent)
      const rentStats = await db("rent_payment")
        .whereIn("house_id", houseIds)
        .select(
          db.raw("SUM(amount) as totalDue"),
          db.raw("SUM(paid_amount) as totalCollected"),
          db.raw(
            'COUNT(CASE WHEN status = "pending" THEN 1 END) as pendingCount'
          ),
          db.raw(
            'COUNT(CASE WHEN status = "overdue" THEN 1 END) as overdueCount'
          )
        )
        .first();

      // Monthly rent collected (current month only)
      const monthlyRentCollected = await db("rent_payment")
        .whereIn("house_id", houseIds)
        .andWhere("status", "paid")
        .andWhere("paid_date", ">=", monthStart)
        .andWhere("paid_date", "<=", monthEnd)
        .sum("paid_amount as total")
        .first();

      // Monthly expenses (current month only)
      const monthlyExpenses = await db("house_expense")
        .whereIn("house_id", houseIds)
        .andWhere("status", "approved")
        .andWhere("expense_date", ">=", monthStart)
        .andWhere("expense_date", "<=", monthEnd)
        .sum("amount as total")
        .first();

      // Total expenses (all time, filtered by date if provided)
      let totalExpensesQuery = db("house_expense")
        .whereIn("house_id", houseIds)
        .andWhere("status", "approved");

      if (dateFilter.startDate) {
        totalExpensesQuery = totalExpensesQuery.andWhere(
          "created_at",
          ">=",
          dateFilter.startDate
        );
      }
      if (dateFilter.endDate) {
        totalExpensesQuery = totalExpensesQuery.andWhere(
          "created_at",
          "<=",
          dateFilter.endDate
        );
      }

      const totalExpensesResult = await totalExpensesQuery
        .sum("amount as total")
        .first();

      // Total advance payments
      const totalAdvance = await db("advance_payment")
        .whereIn("house_id", houseIds)
        .sum("amount as total")
        .first();

      const totalRentDue = parseFloat(rentStats?.totalDue || 0);
      const totalRentCollected = parseFloat(rentStats?.totalCollected || 0);
      const totalExpenses = parseFloat(totalExpensesResult?.total || 0);
      const monthlyRent = parseFloat(monthlyRentCollected?.total || 0);
      const monthlyExpensesAmount = parseFloat(monthlyExpenses?.total || 0);
      const totalAdvanceAmount = parseFloat(totalAdvance?.total || 0);

      const netIncome = totalRentCollected - totalExpenses;
      const monthlyNetIncome = monthlyRent - monthlyExpensesAmount;
      const pendingPayments = parseInt(rentStats?.pendingCount || 0);
      const overduePayments = parseInt(rentStats?.overdueCount || 0);

      return {
        totalRentDue,
        totalRentCollected,
        totalExpenses,
        monthlyRentCollection: monthlyRent,
        monthlyExpenses: monthlyExpensesAmount,
        monthlyNetIncome,
        netIncome,
        pendingPayments,
        overduePayments,
        totalAdvance: totalAdvanceAmount,
        houseCount: houseIds.length,
        houseNames: Object.values(houseDetails).map((h) => h.name),
      };
    } catch (error) {
      console.error("Error in getFinancialOverview:", error);
      throw new Error(
        "Failed to calculate financial overview: " + error.message
      );
    }
  }

  // 6. Send rent reminder instantly for a specific flat
  // Body: { flat_id, houseId }
  async sendRentReminders(req, res) {
    try {
      const { flat_id, houseId } = req.body;
      const userId = req.user.id;

      if (!flat_id || !houseId) {
        return res.status(400).json({
          success: false,
          error: "flat_id and houseId are required",
        });
      }

      // Get flat with house, owner, and renter
      const flat = await db("flat")
        .join("house", "flat.house_id", "house.id")
        .leftJoin("user as house_owner", "house.ownerId", "house_owner.id")
        .leftJoin("renter", "flat.renter_id", "renter.id")
        .where("flat.id", flat_id)
        .andWhere("flat.house_id", houseId)
        .select(
          "flat.*",
          "house.id as house_id",
          "house.name as houseName",
          "house.ownerId",
          "house_owner.name as houseOwnerName",
          "renter.id as renter_id",
          "renter.name as renterName",
          "renter.email as renterEmail",
          "renter.phone as renterPhone",
          "renter.alternativePhone as renterAlternativePhone"
        )
        .first();

      if (!flat) {
        return res.status(404).json({
          success: false,
          error: "Flat not found or does not belong to this house",
        });
      }

      // Check permission (house_owner must own this house)
      if (req.user.role.slug !== "web_owner" && req.user.role.slug !== "staff") {
        const hasAccess = await this.checkHouseAccess(userId, houseId);
        if (!hasAccess) {
          return res.status(403).json({
            success: false,
            error: "You do not have permission to send reminders for this house",
          });
        }
      }

      // Must have a renter
      if (!flat.renter_id) {
        return res.status(400).json({
          success: false,
          error: "No renter assigned to this flat",
        });
      }

      // Get pending rent payment(s) for this flat
      const pendingPayment = await db("rent_payment")
        .where("flat_id", flat_id)
        .andWhere("status", "pending")
        .orderBy("due_date", "asc")
        .first();

      if (!pendingPayment) {
        return res.status(400).json({
          success: false,
          error: "No pending rent payment for this flat",
        });
      }

      // Send email if renter has email
      const emailToUse = flat.renterEmail || null;
      const phoneToUse = flat.renterPhone || flat.renterAlternativePhone || null;

      if (!emailToUse && !phoneToUse) {
        return res.status(400).json({
          success: false,
          error: "Renter has no email or phone to send reminder to",
        });
      }

      try {
        await NotificationService.sendRentReminder({
          flatId: flat.id,
          houseId: flat.house_id,
          renterId: flat.renter_id,
          renterName: flat.renterName,
          email: emailToUse,
          phone: phoneToUse,
          flatNumber: flat.number,
          houseName: flat.houseName,
          amount: pendingPayment.amount,
          dueDate: pendingPayment.due_date,
          houseOwnerName: flat.houseOwnerName || null,
          table_name: 'rent_payment',
          row_id: pendingPayment.id,
        });

        return res.json({
          success: true,
          data: {
            remindersSent: 1,
            results: [
              {
                paymentId: pendingPayment.id,
                renterName: flat.renterName,
                sent: true,
                sentTo: emailToUse ? (phoneToUse ? "email,sms" : "email") : "sms",
              },
            ],
          },
          message: "Rent reminder sent successfully",
        });
      } catch (sendError) {
        console.error("Send rent reminder error:", sendError);
        return res.status(500).json({
          success: false,
          error: "Failed to send rent reminder",
        });
      }
    } catch (error) {
      console.error("Send rent reminders error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to send rent reminders",
      });
    }
  }

  // Resend payment receipt for a rent payment (house_owner/staff/web_owner/caretaker with house access)
  async resendPaymentReceipt(req, res) {
    try {
      const { rent_payment_id } = req.body;
      const userId = req.user.id;

      if (!rent_payment_id) {
        return res.status(400).json({
          success: false,
          error: 'rent_payment_id is required',
        });
      }

      const payment = await db('rent_payment')
        .join('flat', 'rent_payment.flat_id', 'flat.id')
        .join('house', 'rent_payment.house_id', 'house.id')
        .leftJoin('renter', 'rent_payment.renter_id', 'renter.id')
        .where('rent_payment.id', rent_payment_id)
        .select(
          'rent_payment.*',
          'flat.number as flat_number',
          'house.name as house_name',
          'house.id as house_id',
          'renter.name as renter_name',
          'renter.email as renter_email',
          'renter.phone as renter_phone'
        )
        .first();

      if (!payment) {
        return res.status(404).json({
          success: false,
          error: 'Rent payment not found',
        });
      }

      if (payment.status !== 'paid') {
        return res.status(400).json({
          success: false,
          error: 'Cannot resend receipt: payment is not paid',
        });
      }

      if (!payment.renter_email) {
        return res.status(400).json({
          success: false,
          error: 'Renter has no email; cannot send receipt',
        });
      }

      // Permission: web_owner has full access; others must have house access
      if (req.user.role.slug !== 'web_owner') {
        const hasAccess = await this.checkHouseAccess(userId, payment.house_id);
        if (!hasAccess) {
          return res.status(403).json({
            success: false,
            error: 'You do not have permission for this house',
          });
        }
      }

      await NotificationService.sendPaymentReceipt({
        renterName: payment.renter_name,
        email: payment.renter_email,
        phone: payment.renter_phone || null,
        amount: payment.paid_amount,
        paymentDate: payment.paid_date,
        flatNumber: payment.flat_number,
        houseName: payment.house_name,
        transactionId: payment.transaction_id || null,
        table_name: 'rent_payment',
        row_id: payment.id,
      });

      return res.json({
        success: true,
        message: 'Payment receipt has been queued for delivery',
      });
    } catch (error) {
      console.error('Resend payment receipt error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to resend payment receipt',
      });
    }
  }

  // List payment receipts for a flat (emaillog entries with table_name=rent_payment, row_id in flat's payments)
  async listPaymentReceipts(req, res) {
    try {
      const { flat_id } = req.query;
      const userId = req.user.id;

      if (!flat_id) {
        return res.status(400).json({
          success: false,
          error: 'flat_id is required',
        });
      }

      const flat = await db('flat').where('id', flat_id).select('id', 'house_id').first();
      if (!flat) {
        return res.status(404).json({
          success: false,
          error: 'Flat not found',
        });
      }

      // Permission
      if (req.user.role.slug !== 'web_owner') {
        const hasAccess = await this.checkHouseAccess(userId, flat.house_id);
        if (!hasAccess) {
          return res.status(403).json({
            success: false,
            error: 'You do not have permission for this flat',
          });
        }
      }

      const paymentIds = await db('rent_payment')
        .where('flat_id', flat_id)
        .pluck('id');

      if (paymentIds.length === 0) {
        return res.json({
          success: true,
          data: [],
          message: 'No rent payments found for this flat',
        });
      }

      const receipts = await db('emaillog')
        .whereIn('type', ['payment_receipt', 'rent_reminder'])
        .where('table_name', 'rent_payment')
        .whereIn('row_id', paymentIds)
        .orderBy('sentAt', 'desc')
        .select('id', 'toEmail', 'subject', 'status', 'error', 'table_name', 'row_id', 'sentAt', 'metadata');

      return res.json({
        success: true,
        data: serializeBigInt(receipts),
      });
    } catch (error) {
      console.error('List payment receipts error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to list payment receipts',
      });
    }
  }

  // Helper methods [maybe this need to update with your latest code ]
  async checkHouseAccess(userId, houseId) {
    return await accessCache.checkHouseAccess(
      userId,
      houseId,
      db,
      HouseController,
      CaretakerPermissionService
    );
  }

  async getUpcomingPayments(houseIds, houseDetails) {
    try {
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

      const upcomingPayments = await db("rent_payment as rp")
        .join("flat as f", "rp.flat_id", "f.id")
        .join("house as h", "rp.house_id", "h.id")
        .join("renter as r", "rp.renter_id", "r.id")
        .whereIn("rp.house_id", houseIds)
        .andWhere("rp.status", "pending")
        .andWhere("rp.due_date", "<=", thirtyDaysFromNow)
        .andWhere("rp.due_date", ">=", new Date())
        .select(
          "rp.*",
          "f.number as flat_number",
          "f.name as flat_name",
          "h.name as house_name",
          "r.name as renter_name",
          "r.phone as renter_phone",
          db.raw("DATEDIFF(rp.due_date, CURDATE()) as days_left")
        )
        .orderBy("rp.due_date", "asc")
        .limit(20);

      return upcomingPayments.map((payment) => ({
        id: payment.id,
        amount: parseFloat(payment.amount || 0),
        due_date: payment.due_date,
        days_left: payment.days_left,
        status: payment.status,
        flat: {
          id: payment.flat_id,
          number: payment.flat_number,
          name: payment.flat_name,
        },
        house: {
          id: payment.house_id,
          name: payment.house_name,
        },
        renter: {
          id: payment.renter_id,
          name: payment.renter_name,
          phone: payment.renter_phone,
        },
      }));
    } catch (error) {
      console.error("Error in getUpcomingPayments:", error);
      throw new Error("Failed to fetch upcoming payments: " + error.message);
    }
  }

  async getChartData(houseIds, dateFilter) {
    try {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      // Get monthly rent collected
      const monthlyRent = await db("rent_payment")
        .whereIn("house_id", houseIds)
        .andWhere("status", "paid")
        .andWhere("paid_date", ">=", sixMonthsAgo)
        .select(
          db.raw('DATE_FORMAT(paid_date, "%Y-%m") as month'),
          db.raw("SUM(paid_amount) as amount"),
          db.raw("COUNT(*) as payment_count")
        )
        .groupBy("month")
        .orderBy("month", "asc");

      // Get monthly expenses
      const monthlyExpenses = await db("house_expense")
        .whereIn("house_id", houseIds)
        .andWhere("status", "approved")
        .andWhere("expense_date", ">=", sixMonthsAgo)
        .select(
          db.raw('DATE_FORMAT(expense_date, "%Y-%m") as month'),
          db.raw("SUM(amount) as amount"),
          db.raw("COUNT(*) as expense_count")
        )
        .groupBy("month")
        .orderBy("month", "asc");

      // Get payment status distribution
      const paymentStatus = await db("rent_payment")
        .whereIn("house_id", houseIds)
        .select(
          "status",
          db.raw("COUNT(*) as count"),
          db.raw("SUM(amount) as amount")
        )
        .groupBy("status");

      // Get expense categories
      const expenseCategories = await db("house_expense")
        .whereIn("house_id", houseIds)
        .andWhere("status", "approved")
        .andWhere("expense_date", ">=", sixMonthsAgo)
        .select(
          "category",
          db.raw("SUM(amount) as amount"),
          db.raw("COUNT(*) as count")
        )
        .groupBy("category");

      // Get rent collection by house
      const rentByHouse = await db("rent_payment as rp")
        .join("house as h", "rp.house_id", "h.id")
        .whereIn("rp.house_id", houseIds)
        .andWhere("rp.status", "paid")
        .andWhere("rp.paid_date", ">=", sixMonthsAgo)
        .select(
          "h.id as house_id",
          "h.name as house_name",
          db.raw("SUM(rp.paid_amount) as amount"),
          db.raw("COUNT(*) as payment_count")
        )
        .groupBy("h.id", "h.name")
        .orderBy("amount", "desc");

      return {
        monthlyRent: monthlyRent.map((item) => ({
          month: item.month,
          amount: parseFloat(item.amount || 0),
          payment_count: parseInt(item.payment_count || 0),
        })),
        monthlyExpenses: monthlyExpenses.map((item) => ({
          month: item.month,
          amount: parseFloat(item.amount || 0),
          expense_count: parseInt(item.expense_count || 0),
        })),
        paymentStatus: paymentStatus.map((item) => ({
          status: item.status,
          count: parseInt(item.count || 0),
          amount: parseFloat(item.amount || 0),
        })),
        expenseCategories: expenseCategories.map((item) => ({
          category: item.category,
          amount: parseFloat(item.amount || 0),
          count: parseInt(item.count || 0),
        })),
        rentByHouse: rentByHouse.map((item) => ({
          house_id: item.house_id,
          house_name: item.house_name,
          amount: parseFloat(item.amount || 0),
          payment_count: parseInt(item.payment_count || 0),
        })),
      };
    } catch (error) {
      console.error("Error in getChartData:", error);
      throw new Error("Failed to fetch chart data: " + error.message);
    }
  }
}

module.exports = new FinancialController();