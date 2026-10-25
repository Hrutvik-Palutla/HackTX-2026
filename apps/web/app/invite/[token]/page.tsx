import { MuseApp } from "@/components/muse-app";
export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const p = await params;
  return <MuseApp view="invite" id={p.token} />;
}
