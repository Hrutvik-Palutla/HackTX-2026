import Link from "next/link";
export function PlanNavigation({
  id,
  view,
}: {
  id: string;
  view: string;
}) {
  const base = `/plans/${encodeURIComponent(id)}`;
  return (
    <nav className="plan-tabs" aria-label="Plan navigation">
      {[
        ["detail", "Options", base],
        ["private", "My private details", `${base}/private`],
        ["payment", "My share", `${base}/payment`],
      ].map(([key, label, path]) => (
        <Link
          key={key}
          href={path}
          aria-current={view === key ? "page" : undefined}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
