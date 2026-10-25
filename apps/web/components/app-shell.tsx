import Link from "next/link";
import type { ReactNode } from "react";
import { SideQuestLogo } from "./brand";
import { NavigationIcon } from "./navigation-icon";

export const viewDescriptions: Record<string, string> = {
  plans: "Your group’s plans, votes and messages.",
  friends: "Friends who can plan with you.",
  settings: "Manage your profile and account preferences.",
  detail: "Choose every option that works, then pick a favorite.",
  private: "Notes for Sid that your friends can’t see.",
  payment: "Review your share and payment status.",
  studio: "Edit Sid’s instructions and review what happened.",
  login: "Use your phone to access your own group.",
  signup: "Create your account to plan with friends.",
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
  const publicPage = ['home', 'example', 'demo'].includes(view);
  return (
    <div className="app" data-view={view}>
      <header className="app-header">
        <Link className="logo" href={publicPage ? '/' : href("/plans")}>
          <SideQuestLogo />
        </Link>
        <nav className="app-nav" aria-label="Main navigation">
          {publicPage ? <><Link href="/try">Try it</Link><Link href="/#how-it-works">How it works</Link><Link href="/login">Sign in</Link></> : [
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
              : "")}
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
