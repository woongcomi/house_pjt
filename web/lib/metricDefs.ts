/**
 * 화면에 노출되는 지표 정의.
 *
 * 라벨을 이렇게 길게 쓰는 이유: '-9.4%' 처럼 부호만 던지면 무엇 대비인지
 * 알 수 없어 사용자가 오해한다. 기준을 문장에 넣는다.
 */
import type { MetricKey } from "./metrics";

export interface MetricDef {
  key: MetricKey;
  /** 탭에 쓰는 짧은 이름 */
  tab: string;
  /** 카드 제목 */
  label: string;
  /** 한 줄 해설 */
  help: string;
  /** 큰 값이 위로 가는가 */
  descending: boolean;
  /** 값에 상승/하락 색을 입힐지 (변동폭은 방향이 무의미) */
  signed: boolean;
}

export const METRICS: MetricDef[] = [
  {
    key: "ret",
    tab: "수익률",
    label: "기간 수익률",
    help: "고른 기간의 시작과 끝을 비교한 값이에요",
    descending: true,
    signed: true,
  },
  {
    key: "volatility",
    tab: "변동폭",
    label: "변동폭",
    help: "기간 안에서 가장 쌀 때와 가장 비쌀 때의 차이예요. 오른 건지 내린 건지는 알려주지 않아요",
    descending: true,
    signed: false,
  },
  {
    key: "drawdown",
    tab: "고점 대비",
    label: "고점 대비",
    help: "기간 중 최고가에서 지금 얼마나 내려왔는지예요",
    descending: false,
    signed: true,
  },
  {
    key: "recovery",
    tab: "저점 대비",
    label: "저점 대비",
    help: "기간 중 최저가에서 지금 얼마나 올랐는지예요",
    descending: true,
    signed: true,
  },
  {
    key: "mdd",
    tab: "최대 낙폭",
    label: "최대 낙폭",
    help: "고점을 찍은 뒤 가장 크게 빠졌던 폭이에요. 변동폭과 달리 시간 순서를 따져요",
    descending: false,
    signed: true,
  },
];

export const METRIC_BY_KEY = Object.fromEntries(
  METRICS.map((m) => [m.key, m]),
) as Record<MetricKey, MetricDef>;
