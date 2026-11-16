import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: {
    "@utils": fileURLToPath(new URL("./functions/utils", import.meta.url)),
    "middleware": fileURLToPath(new URL("./functions/middleware", import.meta.url)),
    "@otter-music/shared": fileURLToPath(new URL("./shared/src/index.ts", import.meta.url)),
  } },
  test: { environment: "node", include: ["functions/private.security.ts", "functions/metadata.test.ts"] },
});

