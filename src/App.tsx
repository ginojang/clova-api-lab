import Layout from './components/Layout';
import ParamPanel from './components/ParamPanel';
import ChatPanel from './components/ChatPanel';
import RawPanel from './components/RawPanel';

export default function App() {
  return (
    <Layout left={<ParamPanel />} center={<ChatPanel />} right={<RawPanel />} />
  );
}
