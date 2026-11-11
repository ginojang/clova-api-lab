import { Router } from 'express';
import { HarnessLab, LabError } from '../harness/service.ts';

export function harnessRouter(lab: HarnessLab) {
  const router = Router();
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      lab.authenticate(req.get('Authorization'));
      if (!/^[a-f0-9-]{36}$/.test(req.get('X-Harness-Client') ?? '')) throw new LabError(400, '브라우저 테스트 식별자가 없습니다. 화면을 새로 열어 주세요.');
      next();
    } catch (e) { next(e); }
  });
  const owner = (req: { get: (name: string) => string | undefined }) => req.get('X-Harness-Client')!;
  router.get('/info', (_req, res) => res.json(lab.info()));
  router.post('/sessions', async (req, res) => res.status(201).json(await lab.create(owner(req), req.body?.mode, req.body?.model, req.body?.harnessMode, req.body?.provider)));
  router.get('/sessions/:id', (req, res) => res.json(lab.state(owner(req), req.params.id, Number(req.query.after) || 0)));
  router.post('/sessions/:id/prompt', (req, res) => res.json(lab.prompt(owner(req), req.params.id, req.body?.text)));
  router.post('/sessions/:id/approve', (req, res) => res.json(lab.approve(owner(req), req.params.id, req.body?.approvalId, req.body?.allow, req.body?.reason)));
  router.post('/sessions/:id/interrupt', (req, res) => res.json(lab.interrupt(owner(req), req.params.id)));
  router.delete('/sessions/:id', async (req, res) => { await lab.close(owner(req), req.params.id); res.json({ ok: true }); });
  router.get('/sessions/:id/files', (req, res) => res.json({ files: lab.files(owner(req), req.params.id) }));
  router.get('/sessions/:id/file', (req, res) => res.json(lab.file(owner(req), req.params.id, req.query.path)));
  router.get('/sessions/:id/report', (req, res) => res.json(lab.report(owner(req), req.params.id)));
  router.use((error: unknown, _req: import('express').Request, res: import('express').Response, _next: import('express').NextFunction) => {
    res.status(error instanceof LabError ? error.status : 500).json({ error: error instanceof LabError ? error.message : '테스트 요청을 처리하지 못했습니다.' });
  });
  return router;
}
