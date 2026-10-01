import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/test/**",
        "src/**/*.d.ts",
        // Next.js pages, layouts, and root client entry — not unit-testable
        "src/app/**/page.tsx",
        "src/app/layout.tsx",
        "src/app/**/RoomClient.tsx",
        "src/middleware.ts",
        // Auth/session provider wiring
        "src/components/providers/**",
        // Supabase client initialisation files
        "src/lib/supabase/**",
        // Pure shadcn/base-ui re-export wrappers with no logic
        "src/components/ui/alert.tsx",
        "src/components/ui/badge.tsx",
        "src/components/ui/card.tsx",
        "src/components/ui/select.tsx",
        "src/components/ui/separator.tsx",
        "src/components/ui/sheet.tsx",
        "src/components/ui/sonner.tsx",
        "src/components/ui/tabs.tsx",
        // Jira type definitions
        "src/lib/jira/types.ts",
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
  resolve: {
    alias: {
      "@": import.meta.dirname + "/src",
    },
  },
});
