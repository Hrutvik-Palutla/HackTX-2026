"use client";
// Badges for the signed-in account, computed from that account's own friends and plans (server-scoped).
import { useEffect, useState } from "react";
import { api, accountApi } from "@/lib/api";
import type { PlanView } from "@/lib/views";
import { BadgeGrid, BadgeIcon, BadgeReveal, BADGES, chime, type BadgeId } from "./badges";

const ACCOUNT: BadgeId[] = ["first-friend", "circle", "planner", "agreed", "full-table", "connector", "memory"];
const AGREED = ["selected", "quoting", "awaiting_payment_approval", "booking", "needs_handoff", "handoff", "booked", "closed"];

export function accountProgress(userId: string, friends: number, plans: PlanView[]) {
  const mine = plans.filter((p) => p.organizerUserId === userId || !p.organizerUserId);
  const people = new Set(plans.flatMap((p) => p.participants.map((x) => x.id)).filter((id) => id !== userId));
  const biggest = Math.max(0, ...plans.map((p) => p.participants.length));
  const agreed = plans.filter((p) => AGREED.includes(p.status)).length;
  let memory = 0;
  try { memory = localStorage.getItem(`sq:memory-made:${userId}`) ? 1 : 0; } catch { /* storage off */ }
  const at = (have: number, goal: number) => ({ have, earnedOn: have >= goal ? "on SideQuest" : undefined });
  return {
    "first-friend": at(friends, 1),
    circle: at(friends, 5),
    planner: at(mine.length, 3),
    agreed: at(agreed, 1),
    "full-table": at(biggest, 4),
    connector: at(people.size, 5),
    memory: at(memory, 1),
  } as Partial<Record<BadgeId, { have: number; earnedOn?: string }>>;
}

export function AccountBadges({ userId, compact = false }: { userId: string; compact?: boolean }) {
  const [progress, setProgress] = useState<ReturnType<typeof accountProgress> | null>(null);
  const [reveal, setReveal] = useState<BadgeId[]>([]);
  useEffect(() => {
    let live = true;
    void Promise.all([accountApi.friends(), api<PlanView[]>("/plans")])
      .then(([f, plans]) => {
        if (!live) return;
        const p = accountProgress(userId, f.friends.length, plans ?? []);
        setProgress(p);
        const earned = ACCOUNT.filter((id) => p[id]?.earnedOn);
        const key = `sq:badges-seen:${userId}`;
        let seen: string[] = [];
        try { seen = JSON.parse(localStorage.getItem(key) ?? "[]"); } catch { /* none */ }
        const fresh = earned.filter((id) => !seen.includes(id));
        if (fresh.length) {
          setReveal(fresh);
          chime();
          setTimeout(() => live && setReveal([]), 7000);
          try { localStorage.setItem(key, JSON.stringify(earned)); } catch { /* ignore */ }
        }
      })
      .catch(() => undefined);
    return () => { live = false; };
  }, [userId]);
  if (!progress) return null;
  const rows = Object.fromEntries(ACCOUNT.map((id) => [id, progress[id]]));
  const earned = ACCOUNT.filter((id) => progress[id]?.earnedOn);
  const next = ACCOUNT.find((id) => !progress[id]?.earnedOn);
  const nextBadge = BADGES.find((b) => b.id === next);
  return (
    <>
      {compact ? (
        <a className="badge-strip" href="/settings#badges">
          <span className="badge-strip-icons">
            {earned.length ? earned.map((id) => <BadgeIcon key={id} id={id} earned size={30} />) : <BadgeIcon id="first-friend" earned={false} size={30} />}
          </span>
          <span>
            <strong>{earned.length} of {ACCOUNT.length} badges</strong>
            {nextBadge && <small>Next: {nextBadge.name} · {Math.min(progress[nextBadge.id]?.have ?? 0, nextBadge.goal)} of {nextBadge.goal} {nextBadge.unit}</small>}
          </span>
        </a>
      ) : (
        <BadgeGrid progress={rows} ids={ACCOUNT} />
      )}
      <BadgeReveal ids={reveal} onClose={() => setReveal([])} onView={compact ? () => (window.location.href = "/settings#badges") : undefined} />
    </>
  );
}
