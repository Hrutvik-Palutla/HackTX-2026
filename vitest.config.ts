import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['packages/{core,agent,api}/test/**/*.test.ts', 'apps/worker/test/**/*.test.ts'], maxWorkers: 2, hookTimeout: 30_000, testTimeout: 30_000 } });
