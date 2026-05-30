import Layout from './components/Layout';
import ChatView from './components/ChatView';
import BenchView from './components/BenchView';
import AnalysisView from './components/AnalysisView';
import EldaStressView from './components/elda/EldaStressView';
import { useClovaStore } from './store/useClovaStore';

export default function App() {
  const { workspace, mode } = useClovaStore();
  return (
    <Layout>
      {workspace === 'elda' ? (
        <EldaStressView />
      ) : mode === 'bench' ? (
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
