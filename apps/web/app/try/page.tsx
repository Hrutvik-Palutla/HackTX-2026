import type { Metadata } from "next";
import { AdventureDemo } from "@/components/adventure-demo";

export const metadata: Metadata = { title: "Try a group adventure — SideQuest" };

export default function TryPage() {
  return <AdventureDemo />;
}
