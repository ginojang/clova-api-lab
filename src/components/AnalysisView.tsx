import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
// 분석 보고서 MD를 빌드 타임에 raw로 번들(내부 참고용).
import llmMd from '../../analysis/CLOVA-LLM-증류분석.md?raw';
import visionMd from '../../analysis/CLOVA-Vision-증류분석.md?raw';
import fsmMd from '../../analysis/CLOVA-Audio-증류분석.md?raw';

const REPORTS: Record<string, { title: string; md: string }> = {
  llm: { title: 'LLM(언어모델) 증류 분석', md: llmMd },
  vision: { title: 'Vision 인코더 증류 분석', md: visionMd },
  fsm: { title: 'Audio(FSMN) 인코더 증류 분석', md: fsmMd },
};

export default function AnalysisView({ report }: { report: 'llm' | 'vision' | 'fsm' }) {
  const r = REPORTS[report];
  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <div className="prose prose-invert prose-sm mx-auto max-w-4xl prose-table:text-xs prose-pre:text-xs prose-headings:scroll-mt-4">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{r.md}</ReactMarkdown>
      </div>
    </div>
  );
}
