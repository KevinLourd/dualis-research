import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Fake numbers: the real list is the WHATSAPP_ALLOWLIST secret, never in the repo.
    env: {
      WHATSAPP_ALLOWLIST: JSON.stringify([
        { name: "Thierry", phone: "15550000001", lids: ["10000000000001"], role: "client" },
        { name: "Kevin", phone: "15550000002", lids: [], role: "test" },
      ]),
    },
  },
});
