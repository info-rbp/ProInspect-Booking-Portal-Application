import { timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

export type ReleaseState = { phase?: string; releaseId?: string; sourceSha?: string };
type Config = { releaseId: string; sourceSha: string; token: string; ingestToken: string; revision: string };

function equal(a: string, b: string): boolean {
  const left=Buffer.from(a), right=Buffer.from(b);
  return right.length >= 32 && left.length === right.length && timingSafeEqual(left,right);
}

/** A traffic tag on a public service is public. This gate protects the candidate
 * before any parser, portal handler, startup seeding or customer-side effect. */
export function productionReleaseGate(readState: () => Promise<ReleaseState>,
  cfg: Config = {
    releaseId: process.env.PRODUCTION_RELEASE_ID || '',
    sourceSha: process.env.PRODUCTION_SOURCE_SHA || '',
    token: process.env.PRODUCTION_RELEASE_TOKEN || '',
    ingestToken: process.env.REPORT_INGEST_TOKEN || '',
    revision: process.env.K_REVISION || '',
  }) {
  if (cfg.releaseId && (!/^[a-z][a-z0-9-]{2,48}$/.test(cfg.releaseId) ||
      !/^[a-f0-9]{40}$/.test(cfg.sourceSha) || cfg.token.length < 32)) {
    throw new Error('Incomplete production candidate release gate configuration.');
  }
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!cfg.releaseId) return next();
    try {
      const state=await readState();
      const matched=state.releaseId===cfg.releaseId && state.sourceSha===cfg.sourceSha;
      const tester=equal(String(req.headers['x-proinspect-release-token'] || ''),cfg.token);
      if (req.path==='/api/release/health') {
        if (!tester) return res.status(404).end();
        return res.json({ok:true,releaseId:cfg.releaseId,sourceSha:cfg.sourceSha,
          revision:cfg.revision,phase:matched?state.phase:'closed'});
      }
      if (matched && state.phase==='live') {
        res.set('X-ProInspect-Release',cfg.sourceSha);
        res.set('X-ProInspect-Revision',cfg.revision);
        return next();
      }
      const report=req.method==='POST' && req.path==='/api/integrations/reports' &&
        equal(String(req.headers['x-report-ingest-token'] || ''),cfg.ingestToken);
      if (matched && state.phase==='testing' && (tester || report)) return next();
    } catch {
      // A missing/unreadable control record never opens a production candidate.
    }
    res.set('Cache-Control','no-store');
    res.set('Retry-After','60');
    return res.status(503).json({error:'ProInspect is undergoing a controlled update. Please try again shortly.'});
  };
}
