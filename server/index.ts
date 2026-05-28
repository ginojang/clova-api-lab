import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import express from 'express';
import cors from 'cors';
import { healthRouter } from './routes/health.ts';
import { clovaRouter } from './routes/clova.ts';

// 시크릿은 server/.env 에서만 읽는다(프론트 번들에 절대 포함 금지).
const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '.env') });

const app = express();
const PORT = Number(process.env.PORT ?? 3600);
// hellcat 배포 시 HOST=127.0.0.1 (autossh 역방향 터널 전용, 외부 노출 안 함). 로컬은 전체 인터페이스.
const HOST = process.env.HOST ?? '0.0.0.0';

app.use(cors()); // 로컬 개발: Vite(5173) → 프록시(3600) 호출 허용
app.use(express.json({ limit: '1mb' }));

app.use(healthRouter);
app.use('/api/clova', clovaRouter);

app.listen(PORT, HOST, () => {
  console.log(`[clova-api-lab] proxy listening on http://${HOST}:${PORT}`);
});
