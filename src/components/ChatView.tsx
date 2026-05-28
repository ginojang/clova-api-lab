import ParamPanel from './ParamPanel';
import ChatPanel from './ChatPanel';
import RawPanel from './RawPanel';

// Chat 모드 본문: 좌(파라미터) · 중(Chat) · 우(Raw/Log)
export default function ChatView() {
  return (
    <div className="grid h-full grid-cols-[280px_minmax(0,1fr)_360px]">
      <aside className="min-h-0 overflow-y-auto border-r border-slate-800 p-4">
        <ParamPanel />
      </aside>
      <main className="flex min-h-0 flex-col overflow-hidden p-4">
        <ChatPanel />
      </main>
      <aside className="min-h-0 overflow-y-auto border-l border-slate-800 p-4">
        <RawPanel />
      </aside>
    </div>
  );
}
