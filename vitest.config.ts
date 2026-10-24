import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['packages/{core,agent,api}/test/**/*.test.ts', 'apps/worker/test/**/*.test.ts'], testTimeout: 30_000 } });
