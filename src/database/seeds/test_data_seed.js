/**
 * test_data_seed.js — TEST DATA ONLY (safe to run in production).
 *
 * Seeds a realistic slice of app data for end-to-end testing:
 *   - 2 house owners, 1 staff, 2 caretakers (password: Test@123)
 *   - 3 houses / 10 flats (2 left vacant)
 *   - 8 renters assigned to flats
 *   - 3 months of rent payments per occupied flat (2 paid + current pending/overdue)
 *   - caretaker assignments (caretaker -> house)
 *
 * Conventions:
 *   - Every row uses a FIXED uuid (prefix 7e57da7a = "testdata"), so re-running
 *     merges instead of duplicating.
 *   - All emails are random @example.com addresses — edit them in the DB to a
 *     real inbox when you want to verify email delivery.
 *   - Every row carries metadata { testData: true } for later cleanup:
 *       DELETE ... WHERE JSON_EXTRACT(metadata, '$.testData') = true
 *
 * Requires the base seed (roles/permissions) to have run first: npm run seed
 * Run with: npm run seed:test
 */
const crypto = require('crypto');
const db = require('../../config/knex');
const { hashPassword } = require('../../utils/password');

// Fixed uuid per logical entity => idempotent re-runs.
const U = (n) => `7e57da7a-0000-0000-0000-${String(n).padStart(12, '0')}`;

const rand = () => crypto.randomBytes(4).toString('hex');
const testEmail = (tag) => `test.${tag}.${rand()}@example.com`;
const TEST_META = (extra = {}) => JSON.stringify({ testData: true, ...extra });

// 'YYYY-MM' for (current month - offset)
function forMonth(offset) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
// Due date: the 10th of (current month - offset)
function dueDate(offset) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - offset);
  d.setDate(10);
  return d;
}

async function main() {
  console.log('🌱 Seeding TEST data...');

  try {
    await db.transaction(async (trx) => {
      // --- Roles must already exist (base seed) -----------------------------
      const roles = await trx('role').select('id', 'slug');
      const roleMap = {};
      roles.forEach((r) => (roleMap[r.slug] = r.id));
      for (const slug of ['house_owner', 'caretaker', 'staff']) {
        if (!roleMap[slug]) {
          throw new Error(`Role '${slug}' missing — run "npm run seed" (base seed) first.`);
        }
      }

      const { salt, hash } = await hashPassword('Test@123');
      const now = new Date();

      // --- 1) Users ----------------------------------------------------------
      // [uuidN, name, roleSlug, phone, parentUuid|null]
      const users = [
        [1, 'Test Owner Rahim', 'house_owner', '+8801700000101', null],
        [2, 'Test Owner Karim', 'house_owner', '+8801700000102', null],
        [3, 'Test Staff Shafiq', 'staff', '+8801700000103', null],
        [4, 'Test Caretaker Jamal', 'caretaker', '+8801700000104', U(1)],
        [5, 'Test Caretaker Kamal', 'caretaker', '+8801700000105', U(2)],
      ];

      for (const [n, name, slug, phone, parentUuid] of users) {
        let parentId = null;
        if (parentUuid) {
          const [p] = await trx('user').where('uuid', parentUuid).select('id');
          parentId = p ? p.id : null;
        }
        await trx('user')
          .insert({
            uuid: U(n),
            email: testEmail(slug),
            name,
            phone,
            roleId: roleMap[slug],
            parentId,
            passwordHash: hash,
            salt,
            needsPasswordSetup: false,
            locale: 'en',
            status: 'active',
            metadata: TEST_META({ seededBy: 'test_data_seed' }),
            createdAt: now,
            updatedAt: now,
          })
          .onConflict('uuid')
          .merge(['name', 'phone', 'roleId', 'parentId', 'passwordHash', 'salt', 'status', 'metadata', 'updatedAt']);
      }
      console.log('✔ Test users seeded (2 owners, 1 staff, 2 caretakers) — password: Test@123');

      const idByUuid = {};
      for (const [n] of users) {
        const [row] = await trx('user').where('uuid', U(n)).select('id');
        idByUuid[U(n)] = row.id;
      }
      const owner1 = idByUuid[U(1)];
      const owner2 = idByUuid[U(2)];
      const caretaker1 = idByUuid[U(4)];
      const caretaker2 = idByUuid[U(5)];

      // --- 2) Houses ----------------------------------------------------------
      // [uuidN, ownerId, name, address, flatCount]
      const houses = [
        [101, owner1, 'Test Green Villa', 'House 12, Road 5, Dhanmondi, Dhaka', 4],
        [102, owner1, 'Test Lake View House', 'Plot 7, Sector 4, Uttara, Dhaka', 3],
        [103, owner2, 'Test Rose Garden', '25/B Shantinagar, Dhaka', 3],
      ];

      for (const [n, ownerId, name, address, flatCount] of houses) {
        await trx('house')
          .insert({
            uuid: U(n),
            ownerId,
            name,
            address,
            flatCount,
            active: true,
            metadata: TEST_META(),
            createdAt: now,
            updatedAt: now,
          })
          .onConflict('uuid')
          .merge(['ownerId', 'name', 'address', 'flatCount', 'active', 'metadata', 'updatedAt']);
      }
      console.log('✔ Test houses seeded (3)');

      const houseId = {};
      for (const [n] of houses) {
        const [row] = await trx('house').where('uuid', U(n)).select('id');
        houseId[n] = row.id;
      }

      // --- 3) Flats -----------------------------------------------------------
      // [uuidN, houseN, name, number, floor, rent]
      const flats = [
        [201, 101, 'Flat A1', 'A1', 1, 15000],
        [202, 101, 'Flat A2', 'A2', 1, 15000],
        [203, 101, 'Flat B1', 'B1', 2, 18000],
        [204, 101, 'Flat B2', 'B2', 2, 18000],
        [205, 102, 'Flat 1A', '1A', 1, 22000],
        [206, 102, 'Flat 2A', '2A', 2, 22000],
        [207, 102, 'Flat 3A', '3A', 3, 25000],
        [208, 103, 'Unit 1', '1', 1, 12000],
        [209, 103, 'Unit 2', '2', 2, 12000],
        [210, 103, 'Unit 3', '3', 3, 14000],
      ];

      for (const [n, houseN, name, number, floor, rent] of flats) {
        await trx('flat')
          .insert({
            uuid: U(n),
            house_id: houseId[houseN],
            name,
            number,
            floor,
            rent_amount: rent,
            should_pay_rent_day: 10,
            late_fee_percentage: 5.0,
            metadata: TEST_META(),
            createdAt: now,
            updatedAt: now,
          })
          .onConflict('uuid')
          .merge(['house_id', 'name', 'number', 'floor', 'rent_amount', 'metadata', 'updatedAt']);
      }
      console.log('✔ Test flats seeded (10)');

      const flatId = {};
      for (const [n] of flats) {
        const [row] = await trx('flat').where('uuid', U(n)).select('id');
        flatId[n] = row.id;
      }

      // --- 4) Renters (flats 209/210 stay vacant) -----------------------------
      // [uuidN, name, phone, createdBy(ownerId), flatN]
      const renters = [
        [301, 'Test Renter Abdul', '+8801800000301', owner1, 201],
        [302, 'Test Renter Farida', '+8801800000302', owner1, 202],
        [303, 'Test Renter Hasan', '+8801800000303', owner1, 203],
        [304, 'Test Renter Nasrin', '+8801800000304', owner1, 204],
        [305, 'Test Renter Iqbal', '+8801800000305', owner1, 205],
        [306, 'Test Renter Salma', '+8801800000306', owner1, 206],
        [307, 'Test Renter Rafiq', '+8801800000307', owner1, 207],
        [308, 'Test Renter Taslima', '+8801800000308', owner2, 208],
      ];

      for (const [n, name, phone, createdBy] of renters) {
        await trx('renter')
          .insert({
            uuid: U(n),
            name,
            phone,
            email: testEmail('renter'),
            nid: `19900000${n}`,
            status: 'active',
            createdBy,
            metadata: TEST_META(),
            createdAt: now,
            updatedAt: now,
          })
          .onConflict('uuid')
          .merge(['name', 'phone', 'createdBy', 'status', 'metadata', 'updatedAt']);
      }

      const renterId = {};
      for (const [n] of renters) {
        const [row] = await trx('renter').where('uuid', U(n)).select('id');
        renterId[n] = row.id;
      }

      // Assign renters to their flats.
      for (const [n, , , , flatN] of renters) {
        await trx('flat').where('id', flatId[flatN]).update({ renter_id: renterId[n], updatedAt: now });
      }
      console.log('✔ Test renters seeded (8) and assigned to flats');

      // --- 5) Rent payments: 3 months per occupied flat ------------------------
      // Months: offset 2 & 1 = paid; offset 0 = mixed current statuses.
      const methods = ['cash', 'mobile_banking', 'bank'];
      const currentStatus = { 201: 'pending', 202: 'overdue', 203: 'pending', 204: 'partial', 205: 'pending', 206: 'overdue', 207: 'pending', 208: 'pending' };
      // Map flat -> house owner (created_by) via houses.
      const flatHouse = Object.fromEntries(flats.map(([n, houseN]) => [n, houseN]));
      const houseOwner = { 101: owner1, 102: owner1, 103: owner2 };

      let payN = 400;
      let paymentCount = 0;
      for (const [rn, , , , flatN] of renters) {
        const [flatRow] = await trx('flat').where('id', flatId[flatN]).select('rent_amount');
        const rent = Number(flatRow.rent_amount);
        const amenities = 500;
        const houseN = flatHouse[flatN];

        for (const offset of [2, 1, 0]) {
          payN++;
          const isPast = offset > 0;
          const status = isPast ? 'paid' : currentStatus[flatN];
          const paid = status === 'paid';
          const partial = status === 'partial';
          const total = rent + amenities;

          await trx('rent_payment')
            .insert({
              uuid: U(payN),
              flat_id: flatId[flatN],
              renter_id: renterId[rn],
              house_id: houseId[houseN],
              amount: total,
              base_amount: rent,
              amenities_charge: amenities,
              due_date: dueDate(offset),
              for_month: forMonth(offset),
              status,
              paid_date: paid ? dueDate(offset) : null,
              paid_amount: paid ? total : partial ? Math.round(total / 2) : null,
              payment_method: paid || partial ? methods[payN % methods.length] : null,
              transaction_id: paid || partial ? `TEST-${U(payN).slice(-6)}` : null,
              late_fee_amount: 0,
              notes: 'test data',
              metadata: TEST_META(),
              created_by: houseOwner[houseN],
              created_at: now,
              updated_at: now,
            })
            .onConflict('uuid')
            .merge(['amount', 'base_amount', 'amenities_charge', 'status', 'paid_date', 'paid_amount', 'payment_method', 'transaction_id', 'metadata', 'updated_at']);
          paymentCount++;
        }
      }
      console.log(`✔ Test rent payments seeded (${paymentCount}: 2 paid months + current per flat)`);

      // --- 6) Caretaker assignments -------------------------------------------
      const assignments = [
        [501, houseId[101], caretaker1, owner1], // Jamal -> Green Villa
        [502, houseId[103], caretaker2, owner2], // Kamal -> Rose Garden
      ];
      for (const [n, hId, cId, createdBy] of assignments) {
        await trx('caretakerassignment')
          .insert({ uuid: U(n), houseId: hId, caretakerId: cId, createdBy, createdAt: now })
          .onConflict('uuid')
          .ignore();
      }
      console.log('✔ Test caretaker assignments seeded (2)');
    });

    console.log('🎉 Test data seeding completed!');
    console.log('   Login password for all test users: Test@123');
    console.log('   Emails are random @example.com — edit in DB to a real inbox to test mail.');
    console.log("   Cleanup hint: rows are tagged metadata JSON { testData: true }.");
  } catch (err) {
    console.error('❌ Test seed failed:', err);
    process.exitCode = 1;
  } finally {
    await db.destroy();
  }
}

main();
