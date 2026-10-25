// Calendar work for the worker: snapshot participants' busy intervals for planning, and write
// the selected outing into each consenting attendee's own calendar (`sync_calendar`).
import { and, desc, eq } from 'drizzle-orm';
import { calendarEvents, planDecisions, plans, type Db } from '@hacktx/db';
import type { CalendarPort } from '@hacktx/contracts';
import { planMemberIds, type Job } from '@hacktx/core';
import { connectionStatus, icsUidFor } from './google-calendar.ts';

// Snapshot writing moved to core so the planner can refresh without importing this package.
export { refreshPlanAvailability } from '@hacktx/core';

/**
 * `sync_calendar` payload `{planId, userId?}`: write the event for one user, or for every member who granted
 * write access. Others keep the ICS download; their row records that.
 */
export function createSyncCalendarHandler(calendar: CalendarPort) {
  return async ({ db, job }: { db: Db; job: Job }) => {
    const { planId, userId } = job.payload as { planId: string; userId?: string };
    const [plan] = await db.select({ selected: plans.selectedOptionId, versionId: plans.activeVersionId }).from(plans).where(eq(plans.id, planId));
    if (!plan?.selected || !plan.versionId) return; // nothing chosen yet
    const [decision] = await db.select().from(planDecisions).where(and(eq(planDecisions.planId, planId), eq(planDecisions.versionId, plan.versionId), eq(planDecisions.optionId, plan.selected))).orderBy(desc(planDecisions.recordedAt)).limit(1);
    if (!decision) return;
    const attendees = decision.attendeeUserIds;
    for (const uid of userId ? attendees.filter(id => id === userId) : attendees) {
      if ((await connectionStatus(db, uid)).canWriteEvents) {
        await calendar.upsertOwnEvent(uid, planId, plan.versionId);
      } else {
        await db.insert(calendarEvents).values({ planId, userId: uid, versionId: plan.versionId, icsUid: icsUidFor(planId, uid), syncStatus: 'ics_only' })
          .onConflictDoNothing();
      }
    }
  };
}
