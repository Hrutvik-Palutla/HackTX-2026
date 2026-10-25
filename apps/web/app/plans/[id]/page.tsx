import { MuseApp } from "@/components/muse-app";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const p = await params;
  return <MuseApp view="detail" id={p.id} />;
}
