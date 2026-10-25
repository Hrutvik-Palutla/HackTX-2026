// Part 3 messaging tests (root vitest.config.ts only includes Part 2 paths).
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['packages/integrations/messaging/**/*.test.ts'], testTimeout: 30_000 } });
