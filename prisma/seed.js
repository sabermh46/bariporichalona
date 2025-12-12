// const prisma = require("../src/config/prisma");
// const { v4: uuid } = require("uuid");

// async function main() {
//   console.log("🌱 Seeding database...");

//   // 1) Create roles
//   const roles = [
//     { name: "DEVELOPER", slug: "developer", rank: 999, description: "System-level access" },
//     { name: "WEB_OWNER", slug: "web_owner", rank: 100 },
//     { name: "STAFF", slug: "staff", rank: 80 },
//     { name: "HOUSE_OWNER", slug: "house_owner", rank: 60 },
//     { name: "CARETAKER", slug: "caretaker", rank: 40 },
//   ];

//   for (const role of roles) {
//     await prisma.role.upsert({
//       where: { slug: role.slug },
//       update: {},
//       create: {
//         name: role.name,
//         slug: role.slug,
//         rank: role.rank,
//         description: role.description || null,
//       },
//     });
//   }

//   console.log("✔ Roles seeded");

//   // 2) Fetch web_owner role
//   const webOwner = await prisma.role.findUnique({
//     where: { slug: "web_owner" }, // Use slug instead of name
//   });

//   if (!webOwner) throw new Error("WEB_OWNER role missing");

//   // Generate a fixed UUID for the admin user so we can find it consistently
//   const adminUuid = "00000000-0000-0000-0000-000000000001";
  
//   // 3) Check if admin user exists using uuid
//   const existingAdmin = await prisma.user.findUnique({
//     where: { uuid: adminUuid },
//   });

//   // 4) Create or update admin user
//   if (existingAdmin) {
//     await prisma.user.update({
//       where: { uuid: adminUuid },
//       data: {
//         email: "admin@system.local",
//         name: "Web Owner",
//         roleId: webOwner.id,
//       },
//     });
//   } else {
//     await prisma.user.create({
//       data: {
//         uuid: adminUuid,
//         email: "admin@system.local",
//         name: "Web Owner",
//         roleId: webOwner.id,
//       },
//     });
//   }

//   console.log("✔ Admin user ready");

//   // 5) Permissions
//   const permissions = [
//     "manage_users",
//     "manage_houses",
//     "manage_flats",
//     "manage_notices",
//     "manage_templates",
//     "send_notifications",
//   ];

//   for (const key of permissions) {
//     await prisma.permission.upsert({
//       where: { key },
//       update: {},
//       create: {
//         key,
//         description: "",
//       },
//     });
//   }

//   console.log("✔ Permissions seeded");

//   // 6) Assign all permissions to WEB_OWNER
//   const allPerms = await prisma.permission.findMany();
//   for (const perm of allPerms) {
//     await prisma.rolePermission.upsert({
//       where: {
//         roleId_permissionId: {
//           roleId: webOwner.id,
//           permissionId: perm.id,
//         },
//       },
//       update: {},
//       create: {
//         roleId: webOwner.id,
//         permissionId: perm.id,
//       },
//     });
//   }

//   console.log("✔ RolePermission assigned");
//   console.log("🎉 Seeding completed");
// }

// main()
//   .catch((err) => {
//     console.error("❌ Seed failed:", err);
//     process.exit(1);
//   })
//   .finally(async () => {
//     await prisma.$disconnect();
//   });


const prisma = require("../src/config/prisma");
const { v4: uuid } = require("uuid");
const { hashPassword } = require("../src/utils/password");

async function main() {
  console.log("🌱 Seeding database...");

  // 1) Create roles (without flat_renter)
  const roles = [
    { name: "DEVELOPER", slug: "developer", rank: 999, description: "System-level access" },
    { name: "WEB_OWNER", slug: "web_owner", rank: 100, description: "Full system access and settings" },
    { name: "STAFF", slug: "staff", rank: 80, description: "Administrative staff with limited permissions" },
    { name: "HOUSE_OWNER", slug: "house_owner", rank: 60, description: "Owner of one or more houses" },
    { name: "CARETAKER", slug: "caretaker", rank: 40, description: "Caretaker for assigned houses" },
  ];

  for (const role of roles) {
    await prisma.role.upsert({
      where: { slug: role.slug },
      update: {},
      create: {
        name: role.name,
        slug: role.slug,
        rank: role.rank,
        description: role.description,
      },
    });
  }

  console.log("✔ Roles seeded");

  // 2) Fetch roles for later use
  const webOwnerRole = await prisma.role.findUnique({ where: { slug: "web_owner" } });
  const staffRole = await prisma.role.findUnique({ where: { slug: "staff" } });
  const houseOwnerRole = await prisma.role.findUnique({ where: { slug: "house_owner" } });
  const caretakerRole = await prisma.role.findUnique({ where: { slug: "caretaker" } });

  if (!webOwnerRole) throw new Error("WEB_OWNER role missing");

  // 3) Create system settings for registration control
  const systemSettings = [
    { key: 'registration.public_enabled', value: false, type: 'boolean', category: 'registration', isPublic: true },
    { key: 'registration.require_approval', value: true, type: 'boolean', category: 'registration', isPublic: false },
    { key: 'registration.default_role', value: 'house_owner', type: 'string', category: 'registration', isPublic: false },
    { key: 'limits.default_house_limit', value: 1, type: 'number', category: 'limits', isPublic: false },
    { key: 'limits.default_caretaker_limit', value: 2, type: 'number', category: 'limits', isPublic: false },
    { key: 'security.token_expiry_hours', value: 24, type: 'number', category: 'security', isPublic: false },
    { key: 'system.maintenance_mode', value: false, type: 'boolean', category: 'system', isPublic: true },
  ];

  for (const setting of systemSettings) {
    await prisma.systemSetting.upsert({
      where: { key: setting.key },
      update: {},
      create: setting,
    });
  }

  console.log("✔ System settings seeded");

  // 4) Create role limits
  const roleLimits = [
    { roleSlug: 'web_owner', maxHouses: 999, maxCaretakers: 999, maxFlats: 9999, canLoginAs: ['staff', 'house_owner', 'caretaker'] },
    { roleSlug: 'staff', maxHouses: 50, maxCaretakers: 20, maxFlats: 500, canLoginAs: ['house_owner', 'caretaker'] },
    { roleSlug: 'house_owner', maxHouses: 5, maxCaretakers: 5, maxFlats: 50, canLoginAs: ['caretaker'] },
    { roleSlug: 'caretaker', maxHouses: 0, maxCaretakers: 0, maxFlats: 0, canLoginAs: [] },
  ];

  for (const limit of roleLimits) {
    await prisma.roleLimit.upsert({
      where: { roleSlug: limit.roleSlug },
      update: {},
      create: limit,
    });
  }

  console.log("✔ Role limits seeded");

  // 5) Create permissions
  const permissionGroups = {
    // User Management Permissions
    user_management: [
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
      { key: "houses.edit", description: "Edit any house" },
      { key: "houses.edit.own", description: "Edit own houses only" },
      { key: "houses.delete", description: "Delete houses" },
    ],
    
    // Flat Management Permissions
    flat_management: [
      { key: "flats.create", description: "Create new flats" },
      { key: "flats.view", description: "View flat list" },
      { key: "flats.edit", description: "Edit flats" },
      { key: "flats.delete", description: "Delete flats" },
      { key: "flats.assign", description: "Assign flats to renters" },
    ],
    
    // Renter Management Permissions
    renter_management: [
      { key: "renters.create", description: "Create new renters" },
      { key: "renters.view", description: "View renter list" },
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
    ]
  };

  // Create all permissions
  for (const [category, permissions] of Object.entries(permissionGroups)) {
    for (const perm of permissions) {
      await prisma.permission.upsert({
        where: { key: perm.key },
        update: {},
        create: {
          key: perm.key,
          description: perm.description,
        },
      });
    }
  }

  console.log("✔ All permissions seeded");

  // 6) Assign base permissions to roles (without StaffPermissions - those will be per-user)
  
  // Web Owner gets ALL permissions
  const allPermissions = await prisma.permission.findMany();
  for (const perm of allPermissions) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: webOwnerRole.id,
          permissionId: perm.id,
        },
      },
      update: {},
      create: {
        roleId: webOwnerRole.id,
        permissionId: perm.id,
      },
    });
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
    const perm = await prisma.permission.findUnique({ where: { key: permKey } });
    if (perm) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: houseOwnerRole.id,
            permissionId: perm.id,
          },
        },
        update: {},
        create: {
          roleId: houseOwnerRole.id,
          permissionId: perm.id,
        },
      });
    }
  }
  console.log("✔ House owner permissions assigned");

  // Caretaker base permissions
  const caretakerPermissions = [
    "houses.view.assigned",
    "flats.view.assigned",
    "renters.view.assigned",
    "maintenance.create",
    "maintenance.view.assigned",
    "maintenance.resolve",
    "notices.view"
  ];

  for (const permKey of caretakerPermissions) {
    const perm = await prisma.permission.findUnique({ where: { key: permKey } });
    if (perm) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: caretakerRole.id,
            permissionId: perm.id,
          },
        },
        update: {},
        create: {
          roleId: caretakerRole.id,
          permissionId: perm.id,
        },
      });
    }
  }
  console.log("✔ Caretaker permissions assigned");

  // Staff gets NO permissions by default (will be assigned per-user via StaffPermission)
  console.log("⚠ Staff permissions will be assigned per-user");

  // 7) Create admin user with fixed UUID
  const adminUuid = "00000000-0000-0000-0000-000000000001";
  
  const existingAdmin = await prisma.user.findUnique({
    where: { uuid: adminUuid },
  });

  const { salt, hash } = await hashPassword("test@123");
  if (existingAdmin) {
    await prisma.user.update({
      where: { uuid: adminUuid },
      data: {
        email: "sabermahmud.sourav.7@gmail.com",
        name: "Web Owner",
        roleId: webOwnerRole.id,
        passwordHash: hash,
        salt: salt,
        needsPasswordSetup: true,
      },
    });
  } else {
    await prisma.user.create({
      data: {
        uuid: adminUuid,
        email: "sabermahmud.sourav.7@gmail.com",
        name: "Web Owner",
        roleId: webOwnerRole.id,
        passwordHash: hash,
        salt: salt,
        needsPasswordSetup: true,
        metadata: {
          isSystemAdmin: true,
          createdBy: "system",
        },
      },
    });
  }

  console.log("✔ Admin user created (use 'admin@system.local')");

  // 8) Create StaffPermission model (prisma schema update needed first)
  console.log("📝 Note: Add StaffPermission model to Prisma schema before running this");


  console.log("🎉 Seeding completed!");
}

main()
  .catch((err) => {
    console.error("❌ Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });