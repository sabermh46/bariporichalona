require("dotenv").config();
const mysql = require("mysql2/promise");
const { v4: uuid } = require("uuid");

async function seed() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "barip",
  });

  console.log("🔌 Connected to DB");

  try {
    const roles = [
      { name: "DEVELOPER", slug: "developer", rank: 999, description: "System level" },
      { name: "WEB_OWNER", slug: "web_owner", rank: 100, description: null },
      { name: "STAFF", slug: "staff", rank: 80, description: null },
      { name: "HOUSE_OWNER", slug: "house_owner", rank: 60, description: null },
      { name: "CARETAKER", slug: "caretaker", rank: 40, description: null },
    ];

    for (const r of roles) {
      await conn.execute(
        `INSERT IGNORE INTO \`Role\` 
          (\`name\`, \`slug\`, \`rank\`, \`description\`, \`createdAt\`, \`updatedAt\`)
         VALUES (?, ?, ?, ?, NOW(), NOW())`,
        [r.name, r.slug, r.rank, r.description]
      );
    }
    console.log("✅ Roles seeded");

    //
    // 2) FETCH WEB_OWNER ROLE ID
    //
    const [[webOwner]] = await conn.execute(
      `SELECT id FROM Role WHERE slug = 'web_owner' LIMIT 1`
    );
    if (!webOwner) throw new Error("WEB_OWNER role missing");
    const webOwnerRoleId = webOwner.id;

    //
    // 3) WEB OWNER USER
    //
    await conn.execute(
      `INSERT IGNORE INTO \`User\`
       (\`uuid\`, \`email\`, \`name\`, \`roleId\`, \`status\`, \`createdAt\`, \`updatedAt\`)
       VALUES (?, ?, ?, ?, 'active', NOW(), NOW())`,
      [uuid(), "admin@system.local", "Web Owner", webOwnerRoleId]
    );
    console.log("✅ Web owner user created");

    //
    // 4) PERMISSIONS
    //
    const permissions = [
      "manage_users",
      "manage_houses",
      "manage_flats",
      "manage_notices",
      "manage_templates",
      "send_notifications",
    ];

    for (const key of permissions) {
      await conn.execute(
        `INSERT IGNORE INTO \`Permission\`
         (\`key\`, \`description\`, \`createdAt\`, \`updatedAt\`)
         VALUES (?, '', NOW(), NOW())`,
        [key]
      );
    }
    console.log("✅ Permissions seeded");

    //
    // 5) ASSIGN PERMISSIONS TO WEB OWNER
    //
    const [allPerms] = await conn.execute(`SELECT id FROM Permission`);
    for (const p of allPerms) {
      await conn.execute(
        `INSERT IGNORE INTO \`RolePermission\`
         (\`roleId\`, \`permissionId\`, \`createdAt\`)
         VALUES (?, ?, NOW())`,
        [webOwnerRoleId, p.id]
      );
    }
    console.log("✅ RolePermission assignments done");

    console.log("🎉 Manual Seed Completed");
  } catch (err) {
    console.error("Seed failed:", err);
  } finally {
    await conn.end();
  }
}

seed();
