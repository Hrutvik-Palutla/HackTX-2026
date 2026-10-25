import { createDb } from '@hacktx/db';
import { workerReadiness } from '@hacktx/core';

const { db, pool } = createDb();
try {
  const health = await workerReadiness(db, process.env.SOURCE_REVISION ?? 'local');
  if (!health.ready) process.exitCode = 1;
} catch { process.exitCode = 1; }
finally { await pool.end(); }
