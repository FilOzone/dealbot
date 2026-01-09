import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    root: "./",
    include: ["test/**/*.e2e-spec.ts"],
    exclude: process.env.VITEST_INCLUDE_K8S === "true" ? [] : ["test/k8s-integration.e2e-spec.ts"],
    environment: "node",
  },
  plugins: [
    swc.vite({
      module: { type: "es6" },
    }),
  ],
});
