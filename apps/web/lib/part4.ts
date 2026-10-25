// Connect the existing fulfillment service to shared sessions and selected plans.
// Direct purchases remain disabled; checkout is an explicit merchant handoff.
import { and, desc, eq } from 'drizzle-orm';
import { candidates, planDecisions, planOptions, planParticipants, plans, type Db } from '@hacktx/db';
import { AppError, assertMember, loadFactsForFeasibility } from '@hacktx/core';
import { FulfillmentError } from '@hacktx/fulfillment/errors';
import { FulfillmentService, type SelectedPlan } from '@hacktx/fulfillment/service';
import { PostgresRepository, type PgPool } from '@hacktx/fulfillment/postgres';
import { installPart4Runtime } from '@hacktx/fulfillment/http';

export function configurePart4(db: Db, pool: PgPool, getUserId: (request: Request) => Promise<string | null>) {
  const unavailable = async (): Promise<never> => { throw new FulfillmentError('HANDOFF_REQUIRED', 'Direct wallet checkout is not configured. Use the sourced merchant checkout link.', 409); };
  const service = new FulfillmentService({
    repository: new PostgresRepository(pool),
    async loadPlan(actor, planId): Promise<SelectedPlan | null> {
      const plan = await assertMember(db, planId, actor.userId).catch(error => {
        if (error instanceof AppError && error.code === 'NOT_FOUND') throw new FulfillmentError('NOT_FOUND', 'Plan not found.', 404);
        throw error;
      });
      if (!plan.selectedOptionId || !plan.activeVersionId) throw new FulfillmentError('SELECTION_REQUIRED', 'Agree on an outing before checkout or payment tracking.', 409);
      const [option] = await db.select().from(planOptions).where(and(eq(planOptions.id, plan.selectedOptionId), eq(planOptions.versionId, plan.activeVersionId)));
      const payload = option?.payload as { candidateIds?: string[]; title?: string } | undefined;
      const [candidate] = payload?.candidateIds?.[0] ? await db.select().from(candidates).where(eq(candidates.id, payload.candidateIds[0])) : [];
      if (!candidate) throw new FulfillmentError('SOURCE_REQUIRED', 'The selected outing has no sourced merchant data.', 409);
      const members = await db.select({ id: planParticipants.userId }).from(planParticipants).where(eq(planParticipants.planId, planId));
      const [decision] = await db.select().from(planDecisions).where(and(eq(planDecisions.planId, planId), eq(planDecisions.versionId, plan.activeVersionId))).orderBy(desc(planDecisions.recordedAt)).limit(1);
      const maximumShares = Object.fromEntries((await loadFactsForFeasibility(db, planId)).flatMap(f => f.kind === 'spending_limit' ? [[f.ownerUserId, f.value.maximumShare]] : []));
      return { planId, revision: plan.inputRevision, versionId: plan.activeVersionId, optionId: plan.selectedOptionId, title: payload?.title ?? plan.request, memberUserIds: members.flatMap(m => m.id ? [m.id] : []), attendeeUserIds: decision?.attendeeUserIds ?? [], buyerUserId: decision?.buyerUserId ?? null, mode: plan.mode as 'live' | 'test', candidate: candidate.payload as SelectedPlan['candidate'], privateMaximumShares: maximumShares };
    },
    wallet: { startConnect: unavailable, checkConnection: async () => 'not_connected', requestPurchaseApproval: unavailable, refreshAuthorization: unavailable },
    quote: unavailable,
    submit: unavailable,
  });
  installPart4Runtime({
    service,
    authenticate: async request => { const userId = await getUserId(request); return userId ? { userId, source: 'web' } : null; },
    authorizeMutation: async request => Boolean(process.env.BETTER_AUTH_URL) && request.headers.get('origin') === new URL(process.env.BETTER_AUTH_URL!).origin,
  });
}
