import { migrate } from "drizzle-orm/postgres-js/migrator";
import { connectNode } from "../src/db/node";

/** Applies drizzle/ migrations to DATABASE_URL (Neon). Run by the deploy and collect workflows. */
async function main() {
  const { db, close } = connectNode();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migrate(db as any, { migrationsFolder: "drizzle" });
    console.log("[migrate] database is up to date");
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error("[migrate]", err);
  process.exit(1);
});
