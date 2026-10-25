import type { Metadata } from "next";
import "./globals.css";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  icons: { icon: "/brand/sidequest-mark-color.png", apple: "/brand/sidequest-mark-color.png" },
  title: "SideQuest — Find your group's next adventure",
  description: "Turning shared interests into real outings and cooperative quests with your friends.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
