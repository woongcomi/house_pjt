import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * 완전 정적 배포. 데이터는 public/data/*.json 정적 파일이고
   * 지표 계산은 전부 브라우저에서 하므로 서버 함수가 필요 없다.
   * 'export' 로 못박아 두면 서버 의존성이 실수로 들어오는 것을
   * 빌드 타임에 차단할 수 있다.
   */
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
