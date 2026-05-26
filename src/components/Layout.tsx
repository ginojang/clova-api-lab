import type { ReactNode } from 'react';

type LayoutProps = {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
};

/**
 * MVP 3-패널 레이아웃.
 *  좌측: 파라미터 패널 (API Key / Model / Temperature ...)
 *  중앙: Chat 입력 + 응답
 *  우측: Raw Request/Response / Latency / Log
 */
export default function Layout({ left, center, right }: LayoutProps) {
  return (
    <div className="flex h-full flex-col bg-slate-950 text-slate-100">
      <header className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
        <span className="text-lg font-semibold tracking-tight">clova-api-lab</span>
        <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
          AI Provider Lab
        </span>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)_360px]">
        <aside className="min-h-0 overflow-y-auto border-r border-slate-800 p-4">
          {left}
        </aside>

        <main className="flex min-h-0 flex-col overflow-hidden p-4">{center}</main>

        <aside className="min-h-0 overflow-y-auto border-l border-slate-800 p-4">
          {right}
        </aside>
      </div>
    </div>
  );
}
