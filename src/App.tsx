import Layout from './components/Layout';
import ChatView from './components/ChatView';
import BenchView from './components/BenchView';
import AnalysisView from './components/AnalysisView';
import { useClovaStore } from './store/useClovaStore';

export default function App() {
  const mode = useClovaStore((s) => s.mode);
  return (
    <Layout>
      {mode === 'bench' ? (
        <BenchView />
      ) : mode === 'llm' ? (
        <AnalysisView report="llm" />
      ) : mode === 'vision' ? (
        <AnalysisView report="vision" />
      ) : mode === 'fsm' ? (
        <AnalysisView report="fsm" />
      ) : (
        <ChatView />
      )}
    </Layout>
  );
}
