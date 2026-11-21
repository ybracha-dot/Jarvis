import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = { title: "Jarvis", description: "Private chief of staff", robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0d0f12" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
