import { useClovaStore } from '../store/useClovaStore';

export default function ChatPanel() {
  const { userInput, loading, lastResponse, streamingText, set, run } = useClovaStore();

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          User Message
        </span>
        <textarea
          className="h-28 w-full resize-none rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-slate-500 focus:outline-none"
          value={userInput}
          onChange={(e) => set('userInput', e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run();
          }}
          placeholder="메시지를 입력하고 ⌘/Ctrl+Enter 또는 실행 버튼"
        />
        <button
          onClick={run}
          disabled={loading || !userInput.trim()}
          className="self-start rounded bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? '호출 중…' : '실행'}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <span className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Assistant
        </span>
        <div className="min-h-0 flex-1 overflow-y-auto rounded border border-slate-800 bg-slate-900/50 p-3 text-sm whitespace-pre-wrap text-slate-100">
          {loading && streamingText ? (
            <>
              {streamingText}
              <span className="ml-0.5 animate-pulse text-emerald-400">▌</span>
            </>
          ) : lastResponse?.ok ? (
            lastResponse.content || <span className="text-slate-500">(빈 응답)</span>
          ) : lastResponse ? (
            <>
              {lastResponse.content}
              <span className="text-red-400">{lastResponse.content ? '\n\n' : ''}에러: {lastResponse.error}</span>
            </>
          ) : (
            <span className="text-slate-600">응답이 여기에 표시된다.</span>
          )}
        </div>
      </div>
    </div>
  );
}
