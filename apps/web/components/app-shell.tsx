import Link from "next/link";
import type { ReactNode } from "react";
import { SideQuestLogo } from "./brand";
import { NavigationIcon } from "./navigation-icon";

export const viewDescriptions: Record<string, string> = {
  plans: "See what’s coming up and choose what works.",
  friends: "Manage your connections and invitations.",
  settings: "Manage your profile and account preferences.",
  detail: "Choose every option that works, then pick a favorite.",
  private: "Details shared only with you and the planner.",
  payment: "Review your share and payment status.",
  studio: "Templates and redacted execution records.",
  login: "Sign in with your phone to see your plans and friends.",
  signup: "Verify your phone, then complete your profile.",
  invite: "Connect with the friend who invited you.",
};

export function AppShell({
  view,
  preview = false,
  footer,
  children,
}: {
  view: string;
  preview?: boolean;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const href = (path: string) => (preview ? `${path}?preview=1` : path);
  return (
    <div className="app" data-view={view}>
      <header className="app-header">
        <Link className="logo" href={href("/plans")}>
          <SideQuestLogo />
        </Link>
        <nav className="app-nav" aria-label="Main navigation">
          {[
            ["plans", "Plans"],
            ["friends", "Friends"],
            ["settings", "Account"],
          ].map(([key, label]) => (
            <Link
              key={key}
              href={href(`/${key}`)}
              aria-current={
                view === key ||
                (key === "plans" &&
                  ["detail", "private", "payment"].includes(view))
                  ? "page"
                  : undefined
              }
            >
              <NavigationIcon name={key} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
      </header>
      <main className="app-main">
        {preview && (
          <p className="notice">
            Preview · Sample data. Changes reset when you leave the page.
          </p>
        )}
        {children}
      </main>
      <footer className="app-footer">
        <span>SideQuest</span>
        <span>
          {footer ??
            (preview
              ? "Sample workspace · Austin"
              : "Private plans. Connected friends.")}
        </span>
      </footer>
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
