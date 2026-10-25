// Job handler registry. Each part registers its own kinds here (Part 3: send_outbox, sync_calendar;
// Part 4: quote_booking, submit_booking, ...). The worker only claims kinds that have a handler.
import type { Db } from '@hacktx/db';
import type { JobKind } from '@hacktx/contracts';
import type { Job } from '@hacktx/core';

export type JobHandler = (ctx: { db: Db; job: Job; heartbeat: () => Promise<void> }) => Promise<void>;
export const handlers = new Map<JobKind, JobHandler>();
export const register = (kind: JobKind, h: JobHandler) => { handlers.set(kind, h); };
