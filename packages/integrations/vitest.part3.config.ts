// Part 3 tests: pnpm exec vitest run --config packages/integrations/vitest.part3.config.ts (root vitest.config.ts only includes Part 2 paths).
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['packages/integrations/messaging/**/*.test.ts', 'packages/integrations/calendar*.test.ts'], testTimeout: 30_000 } });
