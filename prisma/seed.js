const prisma = require("../src/config/prisma");
const { v4: uuid } = require("uuid");

async function main() {
  console.log("🌱 Seeding database...");

  // 1) Create roles
  const roles = [
    { name: "DEVELOPER", slug: "developer", rank: 999, description: "System-level access" },
    { name: "WEB_OWNER", slug: "web_owner", rank: 100 },
    { name: "STAFF", slug: "staff", rank: 80 },
    { name: "HOUSE_OWNER", slug: "house_owner", rank: 60 },
    { name: "CARETAKER", slug: "caretaker", rank: 40 },
  ];

  for (const role of roles) {
    await prisma.role.upsert({
      where: { slug: role.slug },
      update: {},
      create: {
        name: role.name,
        slug: role.slug,
        rank: role.rank,
        description: role.description || null,
      },
    });
  }

  console.log("✔ Roles seeded");

  // 2) Fetch web_owner role
  const webOwner = await prisma.role.findUnique({
    where: { slug: "web_owner" }, // Use slug instead of name
  });

  if (!webOwner) throw new Error("WEB_OWNER role missing");

  // Generate a fixed UUID for the admin user so we can find it consistently
  const adminUuid = "00000000-0000-0000-0000-000000000001";
  
  // 3) Check if admin user exists using uuid
  const existingAdmin = await prisma.user.findUnique({
    where: { uuid: adminUuid },
  });

  // 4) Create or update admin user
  if (existingAdmin) {
    await prisma.user.update({
      where: { uuid: adminUuid },
      data: {
        email: "admin@system.local",
        name: "Web Owner",
        roleId: webOwner.id,
      },
    });
  } else {
    await prisma.user.create({
      data: {
        uuid: adminUuid,
        email: "admin@system.local",
        name: "Web Owner",
        roleId: webOwner.id,
      },
    });
  }

  console.log("✔ Admin user ready");

  // 5) Permissions
  const permissions = [
    "manage_users",
    "manage_houses",
    "manage_flats",
    "manage_notices",
    "manage_templates",
    "send_notifications",
  ];

  for (const key of permissions) {
    await prisma.permission.upsert({
      where: { key },
      update: {},
      create: {
        key,
        description: "",
      },
    });
  }

  console.log("✔ Permissions seeded");

  // 6) Assign all permissions to WEB_OWNER
  const allPerms = await prisma.permission.findMany();
  for (const perm of allPerms) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: webOwner.id,
          permissionId: perm.id,
        },
      },
      update: {},
      create: {
        roleId: webOwner.id,
        permissionId: perm.id,
      },
    });
  }

  console.log("✔ RolePermission assigned");
  console.log("🎉 Seeding completed");
}

main()
  .catch((err) => {
    console.error("❌ Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });