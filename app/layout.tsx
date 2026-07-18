import type { Metadata } from "next";
import "lxgw-wenkai-screen-webfont/lxgwwenkaigbscreen.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "packup · 行程画布",
  description: "把收藏的小红书笔记打包成一张可拖拽的行程画布"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
