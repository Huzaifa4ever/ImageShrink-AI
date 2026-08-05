
import type { Finding, Scores } from '../rules/catalog';

export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface User {
  id: string;
  username: string;
  email: string;
  avatar?: string | null;
  createdAt: string;
}

export interface SessionPayload {
  token: string;
  tokenType: string;
  expiresIn: number;
  refreshToken: string;
  sessionId: string;
  user: User;
}

export interface DeviceStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

export interface LayerOptimization {
  before: string;
  after: string;
  savedBytes: number;
  reason: string;
}

export interface SchedulingInfo {
  model: string;
  fellBack: boolean;
  queuedMs: number;
  attempts: Array<{ model: string; status: string; reason: string; waitedMs: number }>;
}

export interface ScanSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  unknown: number;
  total: number;
  displayed: number;
  fixable: number;
  misconfigurations: number;
}

export interface AnalysisResult {
  _id: string;
  filename: string;
  originalSize: number;
  optimizedSize: number;
  savingsPercent: number;
  optimizedDockerfile: string;
  aiInsights: string;
  layerOptimizations: LayerOptimization[];

  optimizationScore: number;
  securityScore: number;
  performanceScore: number;
  ruleScores: Scores;
  ruleFindings: Finding[];

  confidence: number;
  aiOptimizationScore: number;
  aiPerformanceScore: number;
  securityNotes: string[];
  dockerignoreSuggestions: string[];

  scanSummary?: ScanSummary;
  vulnerabilities?: Array<Record<string, unknown>>;
  misconfigurations?: Array<Record<string, unknown>>;

  source: 'web' | 'vscode';
  modelUsed: string;
  modelRequested: string;
  favorite: boolean;
  createdAt: string;
  status: string;

  scheduling: SchedulingInfo;
  saved: boolean;
}

export interface AnalysisListItem {
  _id: string;
  filename: string;
  originalSize: number;
  optimizedSize: number;
  savingsPercent: number;
  optimizationScore: number;
  securityScore: number;
  source: 'web' | 'vscode';
  favorite: boolean;
  createdAt: string;
  scanSummary?: ScanSummary;
}

export interface HistoryPage {
  items: AnalysisListItem[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface Stats {
  total: number;
  bySource: { web: number; vscode: number };
  favorites: number;
  bytesSaved: number;
  avgSavingsPercent: number;
  avgOptimizationScore: number;
  avgSecurityScore: number;
  criticalFindings: number;
  highFindings: number;
  lastAnalysisAt: string | null;
}

export interface ExtensionAnalyzeRequest {
  content: string;
  filename: string;
  model?: string;
  dockerignore?: string | undefined;
  hasDockerignore?: boolean | undefined;
  packageJson?: string | undefined;
  dockerHistory?: string | undefined;
  imageMetadata?: string | undefined;
  bloatCandidates: string[];
  save: boolean;
  clientVersion: string;
}
