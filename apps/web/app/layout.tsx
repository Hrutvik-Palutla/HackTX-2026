import type { Metadata } from "next";
import { Cormorant_Garamond, Inter } from "next/font/google";
import "./globals.css";

const display = Cormorant_Garamond({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-display" });
const body = Inter({ subsets: ["latin"], variable: "--font-body" });

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  icons: { icon: "/brand/sidequest-mark-ink.png", apple: "/brand/sidequest-mark-ink.png" },
  title: "SideQuest — Plans with friends, handled.",
  description: "Tell SideQuest what you want to do and who’s coming. It finds the time, the place and the yes.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
