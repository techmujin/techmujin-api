import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        kvNamespaces: ["LAST_GOOD"],
        bindings: {
          // テストは上流 fetch をモックするので、実在しない URL を指しておく
          SHEET_PUB_BASE: "https://sheets.example.com/pub",
        },
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
  },
});
