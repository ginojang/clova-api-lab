import ParamPanel from './ParamPanel';
import BenchPanel from './BenchPanel';

// Bench 모드 본문: 좌(파라미터) · 우(진단 결과표)
export default function BenchView() {
  return (
    <div className="grid h-full grid-cols-[280px_minmax(0,1fr)]">
      <aside className="min-h-0 overflow-y-auto border-r border-slate-800 p-4">
        <ParamPanel />
      </aside>
      <main className="min-h-0 overflow-hidden">
        <BenchPanel />
      </main>
    </div>
  );
}
