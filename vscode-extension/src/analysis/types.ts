import type { Finding, Scores } from '../rules/catalog';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'unknown';

export interface AffectedPackage {
  name: string;
  installedVersion: string;
  fixedVersion: string | null;
}

export interface Vulnerability {
  cveId: string;
  severity: Severity;
  title: string;
  description: string;
  packages: AffectedPackage[];
  referenceUrl: string | null;
  image: string;
  fixable: boolean;
}

export interface Misconfiguration {
  checkId: string;
  severity: Severity;
  title: string;
  description: string;
  resolution: string;
  line: number;
}

export interface ScanSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  unknown: number;
  total: number;
  fixable: number;
  misconfigurations: number;
}

export type ScannerStatus = 'ok' | 'partial' | 'unavailable' | 'disabled' | 'notRun';

export interface ScanResult {
  status: ScannerStatus;

  reason: string;
  version: string | null;
  scannedImages: string[];
  skippedImages: { image: string; reason: string }[];
  vulnerabilities: Vulnerability[];
  misconfigurations: Misconfiguration[];
  summary: ScanSummary;
}

export type SizeConfidence = 'measured' | 'known' | 'estimated' | 'unknown';

export interface SizeEstimate {
  baseImage: string | null;
  baseMb: number | null;
  baseConfidence: SizeConfidence;

  addedMb: number;
  totalMb: number | null;

  optimizedMb: number | null;
  savedMb: number;
  savingsPercent: number;
  confidence: SizeConfidence;
  notes: string[];
}

export interface OptimizedDockerfile {
  content: string;

  changes: string[];

  needsReview: boolean;
}

export interface LocalAnalysis {
  filename: string;
  findings: Finding[];
  scores: Scores;
  size: SizeEstimate;
  scan: ScanResult;
  optimized: OptimizedDockerfile;
  analyzedAt: number;
}

export const EMPTY_SUMMARY: ScanSummary = {
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  unknown: 0,
  total: 0,
  fixable: 0,
  misconfigurations: 0,
};

export function emptyScan(status: ScannerStatus, reason = ''): ScanResult {
  return {
    status,
    reason,
    version: null,
    scannedImages: [],
    skippedImages: [],
    vulnerabilities: [],
    misconfigurations: [],
    summary: { ...EMPTY_SUMMARY },
  };
}
