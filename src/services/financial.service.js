const db = require('../config/knex');
const accessCache = require('../utils/accessCache');
const HouseController = require('../controllers/house.controller');
const CaretakerPermissionService = require('./CaretakerPermission.service');

// Pure date utilities -------------------------------------------------------

function getForMonth(date) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) return null;
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

function calculateNextDueDate(currentDate, dayOfMonth) {
  const day = parseInt(dayOfMonth) || currentDate.getDate();
  const nextMonth = new Date(currentDate);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  nextMonth.setDate(day);
  if (isNaN(nextMonth.getTime())) return new Date();
  return nextMonth;
}

// Access control ------------------------------------------------------------

async function checkHouseAccess(userId, houseId) {
  return accessCache.checkHouseAccess(
    userId,
    houseId,
    db,
    HouseController,
    CaretakerPermissionService
  );
}

// Read-only data helpers (called by dashboard / reporting handlers) ----------

async function getRecentTransactions(houseIds, dateFilter) {
  try {
    const defaultEndDate = new Date();
    const defaultStartDate = new Date();
    defaultStartDate.setMonth(defaultStartDate.getMonth() - 1);

    const start = dateFilter.startDate || defaultStartDate;
    const end = dateFilter.endDate || defaultEndDate;

    const [rentPayments, expenses, advancePayments] = await Promise.all([
      db('rent_payment as rp')
        .join('house as h', 'rp.house_id', 'h.id')
        .leftJoin('flat as f', 'rp.flat_id', 'f.id')
        .leftJoin('renter as r', 'rp.renter_id', 'r.id')
        .whereIn('rp.house_id', houseIds)
        .andWhereBetween('rp.created_at', [start, end])
        .select(
          'rp.*',
          'h.name as house_name',
          'f.number as flat_number',
          'f.name as flat_name',
          'r.name as renter_name',
          db.raw('"rent_payment" as transaction_type')
        )
        .orderBy('rp.created_at', 'desc')
        .limit(15),

      db('house_expense as he')
        .join('house as h', 'he.house_id', 'h.id')
        .whereIn('he.house_id', houseIds)
        .andWhereBetween('he.created_at', [start, end])
        .andWhere('he.status', 'approved')
        .select(
          'he.*',
          'h.name as house_name',
          db.raw('"expense" as transaction_type'),
          db.raw('NULL as flat_number'),
          db.raw('NULL as flat_name'),
          db.raw('NULL as renter_name')
        )
        .orderBy('he.created_at', 'desc')
        .limit(5),

      db('advance_payment as ap')
        .join('house as h', 'ap.house_id', 'h.id')
        .leftJoin('flat as f', 'ap.flat_id', 'f.id')
        .leftJoin('renter as r', 'ap.renter_id', 'r.id')
        .whereIn('ap.house_id', houseIds)
        .andWhereBetween('ap.created_at', [start, end])
        .select(
          'ap.*',
          'h.name as house_name',
          'f.number as flat_number',
          'f.name as flat_name',
          'r.name as renter_name',
          db.raw('"advance_payment" as transaction_type')
        )
        .orderBy('ap.created_at', 'desc')
        .limit(5),
    ]);

    const allTransactions = [...rentPayments, ...expenses, ...advancePayments]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 20);

    return allTransactions.map((tx) => {
      const base = {
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
        case 'rent_payment':
          return {
            ...base,
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
            description: `Rent payment for ${tx.flat_name || `Flat ${tx.flat_number}`}`,
          };
        case 'expense':
          return {
            ...base,
            category: tx.category,
            description: tx.description || `${tx.category} expense`,
            expense_date: tx.expense_date,
            paid_by: tx.paid_by,
            receipt_url: tx.receipt_url,
            approved_by: tx.approved_by,
            metadata: tx.metadata,
          };
        case 'advance_payment':
          return {
            ...base,
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
            description: `Advance payment for ${tx.renter_name || ''}`,
          };
        default:
          return base;
      }
    });
  } catch (error) {
    console.error('getRecentTransactions error:', error);
    throw new Error('Failed to fetch recent transactions: ' + error.message);
  }
}

async function getFinancialOverview(houseIds, dateFilter, houseDetails) {
  try {
    const currentDate = new Date();
    const currentMonth = currentDate.getMonth() + 1;
    const currentYear = currentDate.getFullYear();
    const monthStart = new Date(currentYear, currentMonth - 1, 1);
    const monthEnd = new Date(currentYear, currentMonth, 0);

    let totalExpensesQuery = db('house_expense')
      .whereIn('house_id', houseIds)
      .andWhere('status', 'approved');
    if (dateFilter.startDate) totalExpensesQuery = totalExpensesQuery.andWhere('created_at', '>=', dateFilter.startDate);
    if (dateFilter.endDate) totalExpensesQuery = totalExpensesQuery.andWhere('created_at', '<=', dateFilter.endDate);

    const [rentStats, monthlyRentCollected, monthlyExpenses, totalExpensesResult, totalAdvance] =
      await Promise.all([
        db('rent_payment')
          .whereIn('house_id', houseIds)
          .select(
            db.raw('SUM(amount) as totalDue'),
            db.raw('SUM(paid_amount) as totalCollected'),
            db.raw('COUNT(CASE WHEN status = "pending" THEN 1 END) as pendingCount'),
            db.raw('COUNT(CASE WHEN status = "overdue" THEN 1 END) as overdueCount')
          )
          .first(),

        db('rent_payment')
          .whereIn('house_id', houseIds)
          .andWhere('status', 'paid')
          .andWhere('paid_date', '>=', monthStart)
          .andWhere('paid_date', '<=', monthEnd)
          .sum('paid_amount as total')
          .first(),

        db('house_expense')
          .whereIn('house_id', houseIds)
          .andWhere('status', 'approved')
          .andWhere('expense_date', '>=', monthStart)
          .andWhere('expense_date', '<=', monthEnd)
          .sum('amount as total')
          .first(),

        totalExpensesQuery.sum('amount as total').first(),

        db('advance_payment')
          .whereIn('house_id', houseIds)
          .sum('amount as total')
          .first(),
      ]);

    const totalRentDue = parseFloat(rentStats?.totalDue || 0);
    const totalRentCollected = parseFloat(rentStats?.totalCollected || 0);
    const totalExpenses = parseFloat(totalExpensesResult?.total || 0);
    const monthlyRent = parseFloat(monthlyRentCollected?.total || 0);
    const monthlyExpensesAmount = parseFloat(monthlyExpenses?.total || 0);
    const totalAdvanceAmount = parseFloat(totalAdvance?.total || 0);

    return {
      totalRentDue,
      totalRentCollected,
      totalExpenses,
      monthlyRentCollection: monthlyRent,
      monthlyExpenses: monthlyExpensesAmount,
      monthlyNetIncome: monthlyRent - monthlyExpensesAmount,
      netIncome: totalRentCollected - totalExpenses,
      pendingPayments: parseInt(rentStats?.pendingCount || 0),
      overduePayments: parseInt(rentStats?.overdueCount || 0),
      totalAdvance: totalAdvanceAmount,
      houseCount: houseIds.length,
      houseNames: Object.values(houseDetails).map((h) => h.name),
    };
  } catch (error) {
    console.error('getFinancialOverview error:', error);
    throw new Error('Failed to fetch financial overview: ' + error.message);
  }
}

async function getUpcomingPayments(houseIds) {
  try {
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    const rows = await db('rent_payment as rp')
      .join('flat as f', 'rp.flat_id', 'f.id')
      .join('house as h', 'rp.house_id', 'h.id')
      .join('renter as r', 'rp.renter_id', 'r.id')
      .whereIn('rp.house_id', houseIds)
      .andWhere('rp.status', 'pending')
      .andWhere('rp.due_date', '<=', thirtyDaysFromNow)
      .andWhere('rp.due_date', '>=', new Date())
      .select(
        'rp.*',
        'f.number as flat_number',
        'f.name as flat_name',
        'h.name as house_name',
        'r.name as renter_name',
        'r.phone as renter_phone',
        db.raw('DATEDIFF(rp.due_date, CURDATE()) as days_left')
      )
      .orderBy('rp.due_date', 'asc')
      .limit(20);

    return rows.map((p) => ({
      id: p.id,
      amount: parseFloat(p.amount || 0),
      due_date: p.due_date,
      days_left: p.days_left,
      status: p.status,
      flat: { id: p.flat_id, number: p.flat_number, name: p.flat_name },
      house: { id: p.house_id, name: p.house_name },
      renter: { id: p.renter_id, name: p.renter_name, phone: p.renter_phone },
    }));
  } catch (error) {
    console.error('getUpcomingPayments error:', error);
    throw new Error('Failed to fetch upcoming payments: ' + error.message);
  }
}

async function getChartData(houseIds) {
  try {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const [monthlyRent, monthlyExpenses, paymentStatus, expenseCategories, rentByHouse] =
      await Promise.all([
        db('rent_payment')
          .whereIn('house_id', houseIds)
          .andWhere('status', 'paid')
          .andWhere('paid_date', '>=', sixMonthsAgo)
          .select(
            db.raw('DATE_FORMAT(paid_date, "%Y-%m") as month'),
            db.raw('SUM(paid_amount) as amount'),
            db.raw('COUNT(*) as payment_count')
          )
          .groupBy('month')
          .orderBy('month', 'asc'),

        db('house_expense')
          .whereIn('house_id', houseIds)
          .andWhere('status', 'approved')
          .andWhere('expense_date', '>=', sixMonthsAgo)
          .select(
            db.raw('DATE_FORMAT(expense_date, "%Y-%m") as month'),
            db.raw('SUM(amount) as amount'),
            db.raw('COUNT(*) as expense_count')
          )
          .groupBy('month')
          .orderBy('month', 'asc'),

        db('rent_payment')
          .whereIn('house_id', houseIds)
          .select('status', db.raw('COUNT(*) as count'), db.raw('SUM(amount) as amount'))
          .groupBy('status'),

        db('house_expense')
          .whereIn('house_id', houseIds)
          .andWhere('status', 'approved')
          .andWhere('expense_date', '>=', sixMonthsAgo)
          .select('category', db.raw('SUM(amount) as amount'), db.raw('COUNT(*) as count'))
          .groupBy('category'),

        db('rent_payment as rp')
          .join('house as h', 'rp.house_id', 'h.id')
          .whereIn('rp.house_id', houseIds)
          .andWhere('rp.status', 'paid')
          .andWhere('rp.paid_date', '>=', sixMonthsAgo)
          .select(
            'h.id as house_id',
            'h.name as house_name',
            db.raw('SUM(rp.paid_amount) as amount'),
            db.raw('COUNT(*) as payment_count')
          )
          .groupBy('h.id', 'h.name')
          .orderBy('amount', 'desc'),
      ]);

    return {
      monthlyRent: monthlyRent.map((i) => ({ month: i.month, amount: parseFloat(i.amount || 0), payment_count: parseInt(i.payment_count || 0) })),
      monthlyExpenses: monthlyExpenses.map((i) => ({ month: i.month, amount: parseFloat(i.amount || 0), expense_count: parseInt(i.expense_count || 0) })),
      paymentStatus: paymentStatus.map((i) => ({ status: i.status, count: parseInt(i.count || 0), amount: parseFloat(i.amount || 0) })),
      expenseCategories: expenseCategories.map((i) => ({ category: i.category, amount: parseFloat(i.amount || 0), count: parseInt(i.count || 0) })),
      rentByHouse: rentByHouse.map((i) => ({ house_id: i.house_id, house_name: i.house_name, amount: parseFloat(i.amount || 0), payment_count: parseInt(i.payment_count || 0) })),
    };
  } catch (error) {
    console.error('getChartData error:', error);
    throw new Error('Failed to fetch chart data: ' + error.message);
  }
}

module.exports = {
  getForMonth,
  calculateNextDueDate,
  checkHouseAccess,
  getRecentTransactions,
  getFinancialOverview,
  getUpcomingPayments,
  getChartData,
};
