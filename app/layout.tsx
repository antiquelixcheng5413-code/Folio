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
    "先鉴 Peek 是你的内容价值判断伙伴：分享视频、文章或论文，先看含金量和匹配度，再决定是否投入时间。";
  return {
    metadataBase: new URL(origin),
    title: "先鉴 Peek｜先判断值不值得看",
    description,
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: {
      type: "website",
      title: "先鉴 Peek｜把时间留给真正值得看的内容",
      description,
      url: origin,
      images: [{ url: `${origin}/og-peek.png`, width: 1536, height: 1024, alt: "先鉴 Peek 产品预览" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "先鉴 Peek｜内容价值判断伙伴",
      description,
      images: [`${origin}/og-peek.png`],
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
