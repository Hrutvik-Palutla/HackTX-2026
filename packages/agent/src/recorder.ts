// Real run records for Studio (Northmark): every model/tool/validation/state step with timing, usage and
// a redacted summary. Also enforces the template's per-run limits across the whole run.
import { eq, sql, sum } from 'drizzle-orm';
import { agentRuns, runSteps, type Db } from '@hacktx/db';
import type { AgentTemplate, RunStep } from '@hacktx/contracts';
import { AppError } from '@hacktx/core';
import type { Usage } from './muse';

// Total estimated Muse spend across all runs before new runs are refused (BUDGET_LIMIT). Credits are finite.
const budgetUsd = () => Number(process.env.MUSE_BUDGET_USD ?? 20);
// One message or planning job may not run away: past these, the next model turn stops the run with what it has.
const runBudgetUsd = () => Number(process.env.MUSE_RUN_BUDGET_USD ?? 0.5);
const runDeadlineMs = () => Number(process.env.MUSE_RUN_DEADLINE_MS ?? 90_000);

export class LimitError extends Error {}

export class RunRecorder {
  private index = 0;
  turns = 0;
  tools = 0;
  searches = 0;
  costUsd = 0;
  private readonly startedAt = Date.now();

  private constructor(private db: Db, readonly runId: string, readonly template: AgentTemplate, readonly inputRevision: number) {}

  static async start(db: Db, input: { planId: string | null; task: string; template: AgentTemplate; model: string; inputRevision: number }) {
    const [{ spent } = { spent: null }] = await db.select({ spent: sum(agentRuns.estimatedCostUsd) }).from(agentRuns);
    if (Number(spent ?? 0) >= budgetUsd()) throw new AppError('BUDGET_LIMIT', `Muse budget of ${budgetUsd()} USD reached`);
    const [run] = await db.insert(agentRuns).values({
      planId: input.planId, task: input.task, templateId: input.template.id, templateVersion: input.template.version,
      model: input.model, inputRevision: input.inputRevision, status: 'running',
    }).returning({ id: agentRuns.id });
    return new RunRecorder(db, run!.id, input.template, input.inputRevision);
  }

  /** Call before a model turn / tool call / search; throws LimitError when the template budget is spent. */
  charge(kind: 'turn' | 'tool' | 'search') {
    const { maxTurns, maxTools, maxSearches } = this.template.limits;
    if (kind === 'turn' && this.costUsd >= runBudgetUsd()) throw new LimitError(`run cost limit ${runBudgetUsd()} USD`);
    if (kind === 'turn' && Date.now() - this.startedAt >= runDeadlineMs()) throw new LimitError(`run time limit ${runDeadlineMs() / 1000}s`);
    if (kind === 'turn' && ++this.turns > maxTurns) throw new LimitError(`turn limit ${maxTurns}`);
    if (kind === 'tool' && ++this.tools > maxTools) throw new LimitError(`tool limit ${maxTools}`);
    if (kind === 'search' && ++this.searches > maxSearches) throw new LimitError(`search limit ${maxSearches}`);
  }

  /** Time `fn` and persist one step. `summary` must already be redacted (no private text, tokens, or card data). */
  async step<T>(
    kind: RunStep['kind'],
    name: string,
    fn: () => Promise<T>,
    describe: (r: T) => { summary: string; usage?: Usage; sourceIds?: string[]; outcome?: RunStep['outcome'] } = () => ({ summary: 'ok' }),
  ): Promise<T> {
    const t0 = Date.now();
    try {
      const r = await fn();
      const d = describe(r);
      await this.write(kind, name, Date.now() - t0, d.outcome ?? 'ok', d.summary, d.usage, d.sourceIds);
      return r;
    } catch (e) {
      await this.write(kind, name, Date.now() - t0, 'error', (e instanceof Error ? e.message : String(e)).slice(0, 300));
      throw e;
    }
  }

  private async write(kind: RunStep['kind'], name: string, durationMs: number, outcome: RunStep['outcome'], summary: string, usage?: Usage, sourceIds: string[] = []) {
    await this.db.insert(runSteps).values({
      runId: this.runId, index: this.index++, kind, name, durationMs, inputRevision: this.inputRevision, outcome,
      sourceIds, redactedSummary: summary, inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0,
      estimatedCostUsd: String(usage?.estimatedCostUsd ?? 0),
    });
    if (usage) {
      this.costUsd += usage.estimatedCostUsd;
      await this.db.update(agentRuns).set({
        inputTokens: sql`${agentRuns.inputTokens} + ${usage.inputTokens}`,
        outputTokens: sql`${agentRuns.outputTokens} + ${usage.outputTokens}`,
        estimatedCostUsd: sql`${agentRuns.estimatedCostUsd} + ${usage.estimatedCostUsd}`,
      }).where(eq(agentRuns.id, this.runId));
    }
  }

  async finish(status: 'ok' | 'error' | 'stale' | 'waiting' | 'limit', error?: string) {
    await this.db.update(agentRuns).set({
      status, error: error?.slice(0, 300) ?? null, finishedAt: new Date(), toolCalls: this.tools, searches: this.searches,
    }).where(eq(agentRuns.id, this.runId));
  }
}
