import { redirect } from "next/navigation";

// Sign-in lives on the home page's single phone field; keep old links working (old preview links go to /try).
export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string; preview?: string }> }) {
  const { next, preview } = await searchParams;
  if (preview === "1") redirect("/try");
  redirect(next ? `/?next=${encodeURIComponent(next)}` : "/");
}
