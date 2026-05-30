import BenchPanel from './BenchPanel';

// Bench 모드 본문: 셀 매트릭스만 풀폭. (좌측 파라미터 패널 제거 — 모델은 BenchPanel 상단 드롭다운에서 선택)
export default function BenchView() {
  return (
    <main className="h-full overflow-hidden">
      <BenchPanel />
    </main>
  );
}
