import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ||
    requestHeaders.get("host") ||
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const description =
    "面向知识工作者的个性化会议筛选工具：只需提供公开视频链接，真实 Agent 会给出价值判断、时间码路线和可沉淀的学习笔记。";
  return {
    metadataBase: new URL(origin),
    title: "先鉴｜先判断值不值得看，再决定看什么",
    description,
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: {
      type: "website",
      title: "先鉴｜先判断值不值得看，再决定看什么",
      description,
      url: origin,
      images: [{ url: `${origin}/og.png`, width: 1731, height: 909, alt: "先鉴产品预览" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "先鉴｜会议内容价值判断",
      description,
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
