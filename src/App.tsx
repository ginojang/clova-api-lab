import Layout from './components/Layout';
import ChatView from './components/ChatView';
import BenchView from './components/BenchView';
import { useClovaStore } from './store/useClovaStore';

export default function App() {
  const mode = useClovaStore((s) => s.mode);
  return <Layout>{mode === 'chat' ? <ChatView /> : <BenchView />}</Layout>;
}
