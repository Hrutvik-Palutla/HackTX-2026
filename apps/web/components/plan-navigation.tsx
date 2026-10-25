import Link from "next/link";
export function PlanNavigation({
  id,
  view,
  preview = false,
}: {
  id: string;
  view: string;
  preview?: boolean;
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
          href={preview ? `${path}?preview=1` : path}
          aria-current={view === key ? "page" : undefined}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
