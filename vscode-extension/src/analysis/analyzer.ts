import { config } from '../config';
import * as engine from '../rules/engine';
import type { AnalyzeOptions } from '../rules/engine';
import { optimize } from './optimizer';
import { estimate } from './size';
import { scan } from './trivy';
import type { LocalAnalysis } from './types';
import { emptyScan } from './types';

export interface AnalyzeInput {
  content: string;
  filename: string;

  dockerfilePath?: string | undefined;
  options: AnalyzeOptions;

  skipScan?: boolean;
  signal?: AbortSignal;
}

export async function analyze(input: AnalyzeInput): Promise<LocalAnalysis> {
  const findings = engine.analyze(input.content, input.options);
  const scores = engine.score(findings);

  const [size, scanResult] = await Promise.all([
    estimate(input.content, findings),
    input.skipScan || !config.trivyEnabled()
      ? Promise.resolve(emptyScan(config.trivyEnabled() ? 'notRun' : 'disabled'))
      : scan(input.content, input.dockerfilePath, input.signal),
  ]);

  return {
    filename: input.filename,
    findings,
    scores,
    size,
    scan: scanResult,
    optimized: optimize(input.content, input.options),
    analyzedAt: Date.now(),
  };
}
