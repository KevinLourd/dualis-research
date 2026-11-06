import { defineConfig } from "drizzle-kit";

// `generate` needs no database; `migrate` reads DATABASE_URL (Neon in CI/deploy).
export default defineConfig({
  schema: ["./src/db/schema/ops.ts", "./src/db/schema/bronze.ts", "./src/db/schema/silver.ts", "./src/db/schema/gold.ts", "./src/db/schema/news.ts", "./src/db/schema/thesis.ts", "./src/db/schema/content.ts", "./src/db/schema/app.ts", "./src/db/schema/growth.ts", "./src/db/schema/catalysts.ts", "./src/db/schema/whatsapp.ts", "./src/db/schema/consensus.ts", "./src/db/schema/onedrive.ts", "./src/db/schema/portfolio.ts", "./src/db/schema/financials.ts", "./src/db/schema/analysis.ts", "./src/db/schema/valuation.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  schemaFilter: ["ops", "bronze", "silver", "gold", "app"],
  // Direct (unpooled) URL for DDL; `generate` needs none.
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "" },
});
