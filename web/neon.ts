import { defineConfig } from "@neon/config/v1";

export default defineConfig({ auth: false, branch: (b) => (b.isDefault || b.exists ? {} : { ttl: "7d" }) });
