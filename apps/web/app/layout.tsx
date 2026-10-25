import type { Metadata } from "next";
import "./globals.css";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  icons: { icon: "/brand/sidequest-mark-color.png", apple: "/brand/sidequest-mark-color.png" },
  title: "SideQuest — Make plans. Keep the group chat.",
  description: "Ask Sid in your group chat. Compare places, pick a time, and see who’s in.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
