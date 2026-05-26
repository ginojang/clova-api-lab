import Layout from './components/Layout';

// Step 1: 레이아웃 골격만. 각 패널 내용은 이후 Step에서 채운다.
function Placeholder({ title }: { title: string }) {
  return (
    <div className="text-sm text-slate-500">
      <p className="mb-1 font-medium text-slate-400">{title}</p>
      <p>구현 예정</p>
    </div>
  );
}

export default function App() {
  return (
    <Layout
      left={<Placeholder title="좌측 · 파라미터" />}
      center={<Placeholder title="중앙 · Chat" />}
      right={<Placeholder title="우측 · Raw / Log" />}
    />
  );
}
