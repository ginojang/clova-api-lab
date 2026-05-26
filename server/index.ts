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

app.use(cors()); // 로컬 개발: Vite(5173) → 프록시(3600) 호출 허용
app.use(express.json({ limit: '1mb' }));

app.use(healthRouter);
app.use('/api/clova', clovaRouter);

app.listen(PORT, () => {
  console.log(`[clova-api-lab] proxy listening on http://localhost:${PORT}`);
});
