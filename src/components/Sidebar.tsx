import { useClovaStore, type Workspace } from '../store/useClovaStore';

type Theme = {
  initial: string;
  subtitle: string;
  activeBg: string; // bg gradient classes
  activeText: string;
  activeShadow: string;
  activeRing: string;
  inactiveBg: string;
  inactiveBorder: string;
  inactiveText: string;
  hoverBorder: string;
};

const THEMES: Record<Workspace, Theme> = {
  // ELDA — 보라(자체 추론·지각)
  elda: {
    initial: 'E',
    subtitle: '자체 추론',
    activeBg: 'bg-gradient-to-br from-violet-500 to-fuchsia-700',
    activeText: 'text-white',
    activeShadow: 'shadow-lg shadow-violet-500/50',
    activeRing: 'ring-2 ring-violet-300/70',
    inactiveBg: 'bg-violet-950/40',
    inactiveBorder: 'border-violet-800/60',
    inactiveText: 'text-violet-300',
    hoverBorder: 'hover:border-violet-500/80 hover:bg-violet-900/50',
  },
  // Clova — 에메랄드(거인 + 분석)
  clova: {
    initial: 'C',
    subtitle: '거인+분석',
    activeBg: 'bg-gradient-to-br from-emerald-500 to-teal-700',
    activeText: 'text-white',
    activeShadow: 'shadow-lg shadow-emerald-500/50',
    activeRing: 'ring-2 ring-emerald-300/70',
    inactiveBg: 'bg-emerald-950/40',
    inactiveBorder: 'border-emerald-800/60',
    inactiveText: 'text-emerald-300',
    hoverBorder: 'hover:border-emerald-500/80 hover:bg-emerald-900/50',
  },
};

function Badge({ id, label }: { id: Workspace; label: string }) {
  const { workspace, set } = useClovaStore();
  const active = workspace === id;
  const t = THEMES[id];
  const cls = active
    ? `${t.activeBg} ${t.activeText} ${t.activeShadow} ${t.activeRing} border-transparent -translate-y-0.5`
    : `${t.inactiveBg} ${t.inactiveBorder} ${t.inactiveText} ${t.hoverBorder} hover:-translate-y-0.5`;
  return (
    <button
      onClick={() => set('workspace', id)}
      className={`flex w-full flex-col items-center gap-1 rounded-xl border px-3 py-3 text-sm font-semibold transition-all duration-150 ${cls}`}
    >
      <div
        className={`flex h-9 w-9 items-center justify-center rounded-full font-mono text-base font-bold ${
          active ? 'bg-white/20' : 'bg-slate-900/60'
        }`}
      >
        {t.initial}
      </div>
      <div className="text-[13px] tracking-wide">{label}</div>
      <div className={`text-[10px] font-normal ${active ? 'text-white/80' : 'opacity-70'}`}>
        {t.subtitle}
      </div>
    </button>
  );
}

export default function Sidebar() {
  return (
    <aside className="flex h-full w-[124px] shrink-0 flex-col gap-3 border-r border-slate-800 bg-slate-950/80 p-3">
      <div className="px-1 pt-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">
        WorkArea
      </div>
      <Badge id="elda" label="ELDA" />
      <Badge id="clova" label="Clova" />
    </aside>
  );
}
