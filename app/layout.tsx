import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Packup Trip Pipeline",
  description: "XHS trip planning pipeline"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
