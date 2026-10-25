import { MuseApp } from "@/components/muse-app";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <MuseApp view="private" id={id} />;
}
