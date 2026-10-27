import "dotenv/config";
import { eq } from "drizzle-orm";
import { databaseDialect, db, pool } from "./index.ts";
import { members, notificationSettings } from "./schema.ts";

async function initializeProductionData() {
  const username = (process.env.HORUS_INIT_OWNER_USERNAME || "admin").trim();
  const name = (process.env.HORUS_INIT_OWNER_NAME || "空间管理员").trim();
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
    throw new Error("HORUS_INIT_OWNER_USERNAME must be 3–32 letters, numbers, dots, underscores, or hyphens");
  }
  if (!name || name.length > 40) {
    throw new Error("HORUS_INIT_OWNER_NAME must be 1–40 characters");
  }

  await db.transaction(async tx => {
    const [owner] = await tx.select().from(members).where(eq(members.id, "owner")).for("update");
    if (owner) {
      if (owner.role !== "owner") throw new Error("Member id 'owner' exists but is not a team owner");
      console.info(`Keeping existing owner account '${owner.username}' (idempotent initialization)`);
    } else {
      const [usernameConflict] = await tx.select({ id: members.id }).from(members).where(eq(members.username, username));
      if (usernameConflict) {
        throw new Error(`Cannot create initial owner: username '${username}' is already in use`);
      }
      await tx.insert(members).values({
        id: "owner",
        name,
        username,
        role: "owner",
        teamIds: [],
        passwordHash: null,
        active: true,
      });
      console.info(`Created initial owner account '${username}'. Set its password on first login.`);
    }

    const settingsInsert = tx.insert(notificationSettings).values({ id: "default" });
    if (databaseDialect === "postgres") {
      await (settingsInsert as any).onConflictDoNothing({ target: notificationSettings.id });
    } else {
      await settingsInsert.onDuplicateKeyUpdate({ set: { id: "default" } });
    }
  });
  console.info("Horus production data initialization complete.");
}

try {
  await initializeProductionData();
} finally {
  await pool.end();
}
