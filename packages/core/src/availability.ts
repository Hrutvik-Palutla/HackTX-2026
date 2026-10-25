// Deterministic availability: code, not the LLM, decides whether a slot conflicts.
// Intervals are [start,end) UTC. Missing data is "unknown", never "free".
import type { Interval } from '@hacktx/contracts';

export type KnownBusy = { status: 'known'; window: Interval; busy: Interval[] };
export type MemberAvailability = { userId: string; sources: KnownBusy[] };
export type SlotFit = { conflicts: string[]; unknown: string[]; fit: 'fits_known_constraints' | 'needs_clarification' | 'conflict' };

const ms = (s: string) => Date.parse(s);
export const overlaps = (a: Interval, b: Interval) => ms(a.startAt) < ms(b.endAt) && ms(b.startAt) < ms(a.endAt);
const covers = (outer: Interval, inner: Interval) => ms(outer.startAt) <= ms(inner.startAt) && ms(inner.endAt) <= ms(outer.endAt);

/** Explicit availability statement -> busy within its window (outside `available` is busy when a list is given). */
export function statementToBusy(window: Interval, available: Interval[] | null, unavailable: Interval[]): KnownBusy {
  const busy = [...unavailable];
  if (available) {
    const sorted = [...available].sort((a, b) => ms(a.startAt) - ms(b.startAt));
    let cursor = ms(window.startAt);
    for (const a of sorted) {
      if (ms(a.startAt) > cursor) busy.push({ startAt: new Date(cursor).toISOString(), endAt: a.startAt });
      cursor = Math.max(cursor, ms(a.endAt));
    }
    if (cursor < ms(window.endAt)) busy.push({ startAt: new Date(cursor).toISOString(), endAt: window.endAt });
  }
  return { status: 'known', window, busy };
}

/**
 * A member conflicts if any known source has a busy interval overlapping the slot.
 * A member is unknown if no source's window fully covers the slot.
 */
export function checkSlot(slot: Interval, members: MemberAvailability[]): SlotFit {
  const conflicts: string[] = [];
  const unknown: string[] = [];
  for (const m of members) {
    if (m.sources.some((s) => s.busy.some((b) => overlaps(b, slot)))) conflicts.push(m.userId);
    else if (!m.sources.some((s) => covers(s.window, slot))) unknown.push(m.userId);
  }
  const fit = conflicts.length ? 'conflict' : unknown.length ? 'needs_clarification' : 'fits_known_constraints';
  return { conflicts, unknown, fit };
}
