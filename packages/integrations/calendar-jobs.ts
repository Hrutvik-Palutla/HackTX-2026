// Calendar work for the worker: snapshot participants' busy intervals for planning, and write
// the selected outing into each consenting attendee's own calendar (`sync_calendar`).
import { and, eq, isNotNull } from 'drizzle-orm';
import { availabilitySnapshots, calendarEvents, planParticipants, plans, type Db } from '@hacktx/db';
import type { CalendarPort, Interval } from '@hacktx/contracts';
import type { Job } from '@hacktx/core';
import { connectionStatus, icsUidFor } from './google-calendar.ts';

const SNAPSHOT_TTL_MS = 10 * 60_000;

async function planMembers(db: Db, planId: string) {
  const [p] = await db.select({ organizer: plans.organizerUserId }).from(plans).where(eq(plans.id, planId));
  if (!p) return [];
  const rows = await db.select({ userId: planParticipants.userId }).from(planParticipants)
    .where(and(eq(planParticipants.planId, planId), isNotNull(planParticipants.userId)));
  return [...new Set([p.organizer, ...rows.map((r) => r.userId!)])];
}

/**
 * Fetch each member's free/busy for the window and store it as a plan snapshot. Disconnected or failed calendars
 * are recorded with that status, so Part 2's feasibility treats them as unknown, never as free.
 */
export async function refreshPlanAvailability(db: Db, calendar: CalendarPort, planId: string, window: Interval) {
  const members = await planMembers(db, planId);
  const results = await Promise.all(members.map(async (userId) => ({ userId, r: await calendar.getBusy(userId, window) })));
  for (const { userId, r } of results) {
    await db.insert(availabilitySnapshots).values({
      userId, planId, busy: r.busy, windowStart: new Date(window.startAt), windowEnd: new Date(window.endAt),
      source: 'calendar', status: r.status, fetchedAt: new Date(r.fetchedAt), validUntil: new Date(Date.now() + SNAPSHOT_TTL_MS),
    });
  }
  return results.map(({ userId, r }) => ({ userId, status: r.status, busyCount: r.busy.length }));
}

/**
 * `sync_calendar` payload `{planId, userId?}`: write the event for one user, or for every member who granted
 * write access. Others keep the ICS download; their row records that.
 */
export function createSyncCalendarHandler(calendar: CalendarPort) {
  return async ({ db, job }: { db: Db; job: Job }) => {
    const { planId, userId } = job.payload as { planId: string; userId?: string };
    const [plan] = await db.select({ selected: plans.selectedOptionId, versionId: plans.activeVersionId }).from(plans).where(eq(plans.id, planId));
    if (!plan?.selected || !plan.versionId) return; // nothing chosen yet
    for (const uid of userId ? [userId] : await planMembers(db, planId)) {
      if ((await connectionStatus(db, uid)).canWriteEvents) {
        await calendar.upsertOwnEvent(uid, planId, plan.versionId);
      } else {
        await db.insert(calendarEvents).values({ planId, userId: uid, versionId: plan.versionId, icsUid: icsUidFor(planId, uid), syncStatus: 'ics_only' })
          .onConflictDoNothing();
      }
    }
  };
}
