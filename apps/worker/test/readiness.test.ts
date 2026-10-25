import { afterEach, expect, it, vi } from 'vitest';
import { createReadinessHandler } from '../../web/lib/readiness';
const query = vi.fn();
const end = vi.fn();
const GET = () => createReadinessHandler(() => ({ query, end }))();

afterEach(() => { vi.unstubAllEnvs(); query.mockReset(); end.mockReset(); });

it('does not report ready when the database works but the current worker is missing', async () => {
  vi.stubEnv('DATABASE_URL', 'postgresql://fixture');
  vi.stubEnv('REQUIRE_WORKER_READY', 'true');
  vi.stubEnv('SOURCE_REVISION', 'fixture-release');
  query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
  const response = await GET();
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ status: 'worker_unavailable' });
  expect(query.mock.calls[1]![1]).toEqual(['fixture-release']);
  expect(end).toHaveBeenCalled();
});

it('reports ready only with fresh work and connected delivery lanes', async () => {
  vi.stubEnv('DATABASE_URL', 'postgresql://fixture');
  vi.stubEnv('REQUIRE_WORKER_READY', 'true');
  query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ role: 'work', connected: true }, { role: 'delivery', connected: true }] });
  expect((await GET()).status).toBe(200);
});
