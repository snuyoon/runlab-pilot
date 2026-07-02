import type { MetadataRoute } from "next";

/** PWA 매니페스트 — 아이폰 홈 화면 설치용 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RunLab Pilot",
    short_name: "RunLab",
    description: "AI 스마트 러닝워치 연구 — 파일럿 참여자 앱",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f8fafc",
    theme_color: "#6366f1",
    icons: [
      { src: "/icon-180.png", sizes: "180x180", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
