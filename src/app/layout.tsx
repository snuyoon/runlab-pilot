import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RunLab Pilot",
  description: "AI 스마트 러닝워치 연구 — 파일럿 참여자 앱",
  // 아이폰 홈 화면 추가 시 네이티브 앱처럼 전체 화면으로 실행
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "RunLab",
  },
  icons: {
    apple: "/icon-180.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover", // 노치/다이나믹 아일랜드 영역까지 사용 (safe-area와 함께)
  themeColor: "#f8fafc",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-dvh bg-slate-50">{children}</body>
    </html>
  );
}
