import Layout from './components/Layout';
import ChatView from './components/ChatView';
import BenchView from './components/BenchView';
import AnalysisView from './components/AnalysisView';
import EldaStatusView from './components/elda/EldaStatusView';
import EldaEmbedView from './components/elda/EldaEmbedView';
import EldaRerankView from './components/elda/EldaRerankView';
import EldaBenchView from './components/elda/EldaBenchView';
import { useClovaStore } from './store/useClovaStore';

export default function App() {
  const { workspace, mode, eldaMode } = useClovaStore();
  return (
    <Layout>
      {workspace === 'elda' ? (
        eldaMode === 'status' ? <EldaStatusView />
        : eldaMode === 'embed' ? <EldaEmbedView />
        : eldaMode === 'rerank' ? <EldaRerankView />
        : <EldaBenchView />
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
