import type { NextConfig } from "next";

/**
 * GitHub Pages 는 https://<user>.github.io/<repo>/ 처럼 하위 경로에 올라간다.
 * 배포 워크플로가 BASE_PATH=/house_pjt 를 넣어 주고, 로컬 개발에서는 비워 둔다.
 * Link/router 는 basePath 를 알아서 붙이지만 fetch 경로는 모르므로
 * NEXT_PUBLIC_BASE_PATH 로 lib/loader.ts 에 전달한다.
 */
const basePath = process.env.BASE_PATH || "";

const nextConfig: NextConfig = {
  /**
   * 완전 정적 배포. 데이터는 public/data/*.json 정적 파일이고
   * 지표 계산은 전부 브라우저에서 하므로 서버 함수가 필요 없다.
   * 'export' 로 못박아 두면 서버 의존성이 실수로 들어오는 것을
   * 빌드 타임에 차단할 수 있다.
   */
  output: "export",
  images: { unoptimized: true },
  basePath,
  // /rank → /rank/index.html 로 내보내야 정적 호스팅에서 새로고침해도 열린다
  trailingSlash: true,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};

export default nextConfig;
