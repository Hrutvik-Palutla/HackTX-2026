import Link from "next/link";
import type { ReactNode } from "react";
import { SideQuestLogo } from "./brand";
import { NavigationIcon } from "./navigation-icon";

export const viewDescriptions: Record<string, string> = {
  plans: "Your group’s plans, votes and messages.",
  friends: "Friends who can plan with you.",
  settings: "Your profile, calendar and account.",
  detail: "Choose every option that works, then pick a favorite.",
  private: "Notes for Sid that your friends can’t see.",
  payment: "Review your share and payment status.",
  studio: "Edit Sid’s instructions and review what happened.",
  login: "Use your phone to access your own group.",
  signup: "A few details so your friends recognize you.",
  invite: "Connect with the friend who invited you.",
};

// Signed-in destinations, in sidebar order.
const SECTIONS = [
  ["friends", "Friends"],
  ["plans", "Current Plans"],
  ["settings", "Settings"],
] as const;

export function AppShell({
  view,
  children,
}: {
  view: string;
  children: ReactNode;
}) {
  const authPage = ["login", "signup"].includes(view);

  if (authPage) {
    return (
      <div className="auth-layout" data-view={view}>
        <Link className="logo" href="/">
          <SideQuestLogo />
        </Link>
        <main className="auth-main">{children}</main>
      </div>
    );
  }

  return (
    <div className="console" data-view={view}>
      <aside className="console-sidebar">
        <Link className="logo" href="/plans">
          <SideQuestLogo />
        </Link>
        <nav className="console-nav" aria-label="Main navigation">
          {SECTIONS.map(([key, label]) => (
            <Link
              key={key}
              href={`/${key}`}
              aria-current={
                view === key ||
                (key === "plans" && ["detail", "private", "payment"].includes(view))
                  ? "page"
                  : undefined
              }
            >
              <NavigationIcon name={key} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
      </aside>
      <main className="console-main">
        {children}
      </main>
    </div>
  );
}
export function PageHeading({
  title,
  view,
  context = "SideQuest",
  meta,
  back,
}: {
  title: string;
  view: string;
  context?: string;
  meta?: ReactNode;
  back?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {back && <div className="page-back">{back}</div>}
        <span className="eyebrow">{context}</span>
        <h1>{title}</h1>
        {viewDescriptions[view] && (
          <p className="page-description">{viewDescriptions[view]}</p>
        )}
      </div>
      {meta && <span className="page-meta">{meta}</span>}
    </div>
  );
}
