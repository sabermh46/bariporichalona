const db = require('../../config/knex');
const { v4: uuidv4 } = require('uuid');
const { hashPassword } = require('../../utils/password');

async function main() {
  console.log("🌱 Seeding database with Knex...");

  try {
    // Start transaction
    await db.transaction(async (trx) => {
      // 1) Create roles (without flat_renter)
      const roles = [
        { name: "DEVELOPER", slug: "developer", rank: 999, description: "System-level access" },
        { name: "WEB_OWNER", slug: "web_owner", rank: 100, description: "Full system access and settings" },
        { name: "STAFF", slug: "staff", rank: 80, description: "Administrative staff with limited permissions" },
        { name: "HOUSE_OWNER", slug: "house_owner", rank: 60, description: "Owner of one or more houses" },
        { name: "CARETAKER", slug: "caretaker", rank: 40, description: "Caretaker for assigned houses" },
      ];

      for (const role of roles) {
        await trx('role')
          .insert(role)
          .onConflict('slug')
          .merge(['name', 'rank', 'description', 'updatedAt']);
      }

      console.log("✔ Roles seeded");

      // 2) Fetch roles for later use
      const rolesFromDb = await trx('role').select('id', 'slug');
      const roleMap = {};
      rolesFromDb.forEach(r => roleMap[r.slug] = r.id);

      const webOwnerRoleId = roleMap['web_owner'];
      const developerRoleId = roleMap['developer'];
      const staffRoleId = roleMap['staff'];
      const houseOwnerRoleId = roleMap['house_owner'];
      const caretakerRoleId = roleMap['caretaker'];

      if (!webOwnerRoleId) throw new Error("WEB_OWNER role missing");

      // 3) Create system settings for registration control
      const systemSettings = [
        { key: 'registration.public_enabled', value: 'false', type: 'boolean', category: 'registration', isPublic: true },
        { key: 'registration.require_approval', value: 'true', type: 'boolean', category: 'registration', isPublic: false },
        { key: 'registration.default_role', value: 'house_owner', type: 'string', category: 'registration', isPublic: false },
        { key: 'limits.default_house_limit', value: '1', type: 'number', category: 'limits', isPublic: false },
        { key: 'limits.default_caretaker_limit', value: '2', type: 'number', category: 'limits', isPublic: false },
        { key: 'security.token_expiry_hours', value: '24', type: 'number', category: 'security', isPublic: false },
        { key: 'system.maintenance_mode', value: 'false', type: 'boolean', category: 'system', isPublic: true },
      ];

      for (const setting of systemSettings) {
        await trx('systemsetting')
          .insert(setting)
          .onConflict('key')
          .merge(['value', 'type', 'category', 'isPublic', 'updatedAt']);
      }

      console.log("✔ System settings seeded");

      // 4) Create role limits
      const roleLimits = [
        { roleSlug: 'web_owner', maxHouses: 999, maxCaretakers: 999, maxFlats: 9999, canLoginAs: JSON.stringify(['staff', 'house_owner', 'caretaker']) },
        { roleSlug: 'staff', maxHouses: 50, maxCaretakers: 20, maxFlats: 500, canLoginAs: JSON.stringify(['house_owner', 'caretaker']) },
        { roleSlug: 'house_owner', maxHouses: 5, maxCaretakers: 5, maxFlats: 50, canLoginAs: JSON.stringify(['caretaker']) },
        { roleSlug: 'caretaker', maxHouses: 0, maxCaretakers: 0, maxFlats: 0, canLoginAs: JSON.stringify([]) },
      ];

      for (const limit of roleLimits) {
        await trx('rolelimit')
          .insert(limit)
          .onConflict('roleSlug')
          .merge(['maxHouses', 'maxCaretakers', 'maxFlats', 'canLoginAs', 'updatedAt']);
      }

      console.log("✔ Role limits seeded");

      // 5) Create permissions
      const permissionGroups = {
        // User Management Permissions
        user_management: [
          { key: "registrationToken.create", description: "Create new House_Owner/Staff/Caretaker users" },
          { key: "users.create", description: "Create new users" },
          { key: "users.view", description: "View user list and details" },
          { key: "users.edit", description: "Edit user information" },
          { key: "users.delete", description: "Delete users" },
          { key: "users.manage_permissions", description: "Manage user permissions" },
          { key: "users.impersonate", description: "Login as other users" },
        ],
        
        // House Management Permissions
        house_management: [
          { key: "houses.create", description: "Create new houses" },
          { key: "houses.view", description: "View house list" },
          { key: "houses.view.own", description: "View own houses only" },
          { key: "houses.view.assigned", description: "View houses assigned to caretaker" },
          { key: "houses.edit", description: "Edit any house" },
          { key: "houses.edit.own", description: "Edit own houses only" },
          { key: "houses.delete", description: "Delete houses" },
        ],

        // Flat Management Permissions
        flat_management: [
          { key: "flats.create", description: "Create new flats" },
          { key: "flats.view", description: "View flat list" },
          { key: "flats.view.assigned", description: "View flats in assigned houses (caretaker)" },
          { key: "flats.edit", description: "Edit flats" },
          { key: "flats.delete", description: "Delete flats" },
          { key: "flats.assign", description: "Assign flats to renters" },
        ],

        // Renter Management Permissions
        renter_management: [
          { key: "renters.create", description: "Create new renters" },
          { key: "renters.view", description: "View renter list" },
          { key: "renters.view.assigned", description: "View renters in assigned houses (caretaker)" },
          { key: "renters.edit", description: "Edit renter information" },
          { key: "renters.delete", description: "Delete renters" },
        ],
        
        // Caretaker Management Permissions
        caretaker_management: [
          { key: "caretakers.create", description: "Create new caretakers" },
          { key: "caretakers.view", description: "View caretaker list" },
          { key: "caretakers.assign", description: "Assign caretakers to houses" },
          { key: "caretakers.remove", description: "Remove caretakers from houses" },
        ],
        
        // Notice Management Permissions
        notice_management: [
          { key: "notices.create", description: "Create new notices" },
          { key: "notices.create.own", description: "Create notices for own houses" },
          { key: "notices.view", description: "View notices" },
          { key: "notices.edit", description: "Edit notices" },
          { key: "notices.delete", description: "Delete notices" },
          { key: "notices.publish", description: "Publish notices" },
        ],
        
        // Payment Management Permissions
        payment_management: [
          { key: "payments.create", description: "Create payment records" },
          { key: "payments.view", description: "View payment records" },
          { key: "payments.verify", description: "Verify payments" },
          { key: "payments.delete", description: "Delete payment records" },
          { key: "invoices.generate", description: "Generate invoices" },
        ],
        
        // Maintenance Management Permissions
        maintenance_management: [
          { key: "maintenance.create", description: "Create maintenance requests" },
          { key: "maintenance.view", description: "View maintenance requests" },
          { key: "maintenance.view.assigned", description: "View assigned maintenance requests" },
          { key: "maintenance.edit", description: "Edit maintenance requests" },
          { key: "maintenance.resolve", description: "Resolve maintenance requests" },
        ],
        
        // Report & Analytics Permissions
        report_management: [
          { key: "reports.view", description: "View reports" },
          { key: "reports.generate", description: "Generate reports" },
          { key: "reports.export", description: "Export reports" },
          { key: "analytics.view", description: "View analytics dashboard" },
        ],
        
        // System Management Permissions (Web Owner Only)
        system_management: [
          { key: "system.settings.view", description: "View system settings" },
          { key: "system.settings.edit", description: "Edit system settings" },
          { key: "system.roles.manage", description: "Manage roles and permissions" },
          { key: "system.logs.view", description: "View system logs" },
          { key: "system.backup", description: "Create system backups" },
        ],
        
        // Template Management Permissions
        template_management: [
          { key: "templates.create", description: "Create templates" },
          { key: "templates.view", description: "View templates" },
          { key: "templates.edit", description: "Edit templates" },
          { key: "templates.delete", description: "Delete templates" },
        ],
        
        // Notification Permissions
        notification_management: [
          { key: "notifications.send", description: "Send notifications" },
          { key: "notifications.broadcast", description: "Send broadcast notifications" },
          { key: "notifications.templates.manage", description: "Manage notification templates" },
        ],

        app_fees: [
          //create, view, verify, delete
          { key: "app_fees.view", description: "View application fee payments" },
          { key: "app_fees.verify", description: "Verify application fee payments" },
          { key: "app_fees.delete", description: "Delete application fee payments" },
          { key: "app_fees.create", description: "Create application fee payments" },
          
        ]


      };

      // Create all permissions
      for (const [category, permissions] of Object.entries(permissionGroups)) {
        for (const perm of permissions) {
          await trx('permission')
            .insert(perm)
            .onConflict('key')
            .merge(['description', 'updatedAt']);
        }
      }

      console.log("✔ All permissions seeded");

      // Get all permissions for role assignment
      const allPermissions = await trx('permission').select('id', 'key');
      const permissionMap = {};
      allPermissions.forEach(p => permissionMap[p.key] = p.id);

      // 6) Assign base permissions to roles
      
      // Web Owner gets ALL permissions
      for (const perm of allPermissions) {
        await trx('rolepermission')
          .insert({
            roleId: webOwnerRoleId,
            permissionId: perm.id,
          })
          .onConflict(['roleId', 'permissionId'])
          .ignore(); // Use ignore instead of merge since there's nothing to update
      }
      console.log("✔ Web owner permissions assigned");

      // House Owner base permissions
      const houseOwnerPermissions = [
        "houses.create", "houses.view.own", "houses.edit.own",
        "flats.create", "flats.view", "flats.edit", "flats.assign",
        "renters.create", "renters.view", "renters.edit", "renters.delete",
        "caretakers.create", "caretakers.view", "caretakers.assign", "caretakers.remove",
        "notices.create.own", "notices.view",
        "payments.create", "payments.view",
        "maintenance.create", "maintenance.view",
        "invoices.generate"
      ];

      for (const permKey of houseOwnerPermissions) {
        const permId = permissionMap[permKey];
        if (permId) {
          await trx('rolepermission')
            .insert({
              roleId: houseOwnerRoleId,
              permissionId: permId,
            })
            .onConflict(['roleId', 'permissionId'])
            .ignore();
        }
      }
      console.log("✔ House owner permissions assigned");

      // Caretaker base permissions
      const caretakerPermissions = [
        "houses.view.assigned",   // now defined in house_management
        "flats.view.assigned",    // now defined in flat_management
        "renters.view.assigned",  // now defined in renter_management
        "maintenance.create",
        "maintenance.view.assigned",
        "maintenance.resolve",
        "notices.view"
      ];

      for (const permKey of caretakerPermissions) {
        const permId = permissionMap[permKey];
        if (permId) {
          await trx('rolepermission')
            .insert({
              roleId: caretakerRoleId,
              permissionId: permId,
            })
            .onConflict(['roleId', 'permissionId'])
            .ignore();
        }
      }
      console.log("✔ Caretaker permissions assigned");

      // Staff gets NO permissions by default
      console.log("⚠ Staff permissions will be assigned per-user");

      // 7) Create System Users (Developer & Web Owner)
      const { salt, hash } = await hashPassword("Test@123");
      const developerUuid = "00000000-0000-0000-0000-000000000000";
      const adminUuid = "00000000-0000-0000-0000-000000000001";

      // Create/Update Developer
      await trx('user')
        .insert({
          uuid: developerUuid,
          email: "sabermahmud.sourav.7@gmail.com",
          name: "Saber Mahmud Sourav",
          roleId: developerRoleId,
          passwordHash: hash,
          salt: salt,
          needsPasswordSetup: true,
          locale: "en",
          status: "active",
          metadata: JSON.stringify({ isDeveloper: true, createdBy: "system" }),
          createdAt: new Date(),
          updatedAt: new Date()
        })
        .onConflict('uuid')
        .merge([
          'email', 'name', 'roleId', 'passwordHash', 'salt', 
          'needsPasswordSetup', 'metadata', 'updatedAt'
        ]);

      console.log("✔ Developer user ready");

      // Create/Update Web Owner
      await trx('user')
        .insert({
          uuid: adminUuid,
          email: "tanvirhaque.org@gmail.com",
          name: "Tanvir Haque",
          roleId: webOwnerRoleId,
          passwordHash: hash,
          salt: salt,
          needsPasswordSetup: true,
          locale: "en",
          status: "active",
          metadata: JSON.stringify({ isSystemAdmin: true, createdBy: "system" }),
          createdAt: new Date(),
          updatedAt: new Date()
        })
        .onConflict('uuid')
        .merge([
          'email', 'name', 'roleId', 'passwordHash', 'salt',
          'needsPasswordSetup', 'metadata', 'updatedAt'
        ]);

      console.log("✔ Web Owner user ready");
    });

    console.log("🎉 Seeding completed!");
  } catch (err) {
    console.error("❌ Seed failed:", err);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

main();