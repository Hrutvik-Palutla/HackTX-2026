// Calendar free/busy snapshots for planning. Lives in core so the planner can refresh through any CalendarPort
// without depending on the Google adapter; Part 3's calendar-jobs re-exports it.
import { and, eq, isNotNull } from 'drizzle-orm';
import { availabilitySnapshots, planParticipants, plans, type Db } from '@hacktx/db';
import type { BusyResult, CalendarPort, Interval } from '@hacktx/contracts';

const SNAPSHOT_TTL_MS = 10 * 60_000;

/** Organizer plus every resolved participant. */
export async function planMemberIds(db: Db, planId: string) {
  const [p] = await db.select({ organizer: plans.organizerUserId }).from(plans).where(eq(plans.id, planId));
  if (!p) return [];
  const rows = await db.select({ userId: planParticipants.userId }).from(planParticipants)
    .where(and(eq(planParticipants.planId, planId), isNotNull(planParticipants.userId)));
  return [...new Set([p.organizer, ...rows.map((r) => r.userId!)])];
}

/**
 * Fetch each member's free/busy for the window and store it as a plan snapshot. Disconnected or failed calendars
 * (including a port that throws) are recorded with that status, so feasibility treats them as unknown, never as free.
 */
export async function refreshPlanAvailability(db: Db, calendar: CalendarPort, planId: string, window: Interval) {
  const members = await planMemberIds(db, planId);
  const results = await Promise.all(members.map(async (userId) => {
    const r: BusyResult = await calendar.getBusy(userId, window)
      .catch(() => ({ busy: [], fetchedAt: new Date().toISOString(), status: 'error' as const }));
    return { userId, r };
  }));
  for (const { userId, r } of results) {
    await db.insert(availabilitySnapshots).values({
      userId, planId, busy: r.status === 'ok' ? r.busy : [], windowStart: new Date(window.startAt), windowEnd: new Date(window.endAt),
      source: 'calendar', status: r.status, fetchedAt: new Date(r.fetchedAt), validUntil: new Date(Date.now() + SNAPSHOT_TTL_MS),
    });
  }
  return results.map(({ userId, r }) => ({ userId, status: r.status, busyCount: r.busy.length }));
}
