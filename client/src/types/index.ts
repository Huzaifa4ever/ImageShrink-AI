
export interface DockerfileUpload {
  content: string;
  filename: string;
}

export interface DockerLayer {
  id: string;
  command: string;
  size: number;
  sizeHuman: string;
  isOptimizable: boolean;
  suggestion?: string;
}

export interface BuildStage {
  id: string;
  name: string;
  baseImage: string;
  layers: DockerLayer[];
  totalSize: number;
  isFinalStage: boolean;
}

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
export interface AffectedPackage {
  name: string;
  installedVersion: string;
  fixedVersion?: string | null;
  fixState?: string;
}

export interface SecurityVulnerability {
  id: string;
  cveId: string;
  severity: Severity;
  package: string;
  installedVersion: string;
  description: string;
  fixedVersion?: string | null;
  referenceUrl?: string;
  target?: string;
  fixState?: string;
  source?: string;
  packages?: AffectedPackage[];
  packageCount?: number;
  targets?: string[];
}

export interface Misconfiguration {
  id: string;
  checkId: string;
  severity: Severity;
  title: string;
  description: string;
  resolution?: string;
  referenceUrl?: string;
  line?: number;
  target?: string;
  source?: string;
}

export interface ScanSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  unknown: number;
  total: number;
  displayed: number;
  occurrences?: number;
  fixable: number;
  misconfigurations: number;
}

export interface ScannerInfo {
  name: string;
  status: 'ok' | 'partial' | 'unavailable' | 'disabled';
  version?: string | null;
  dbUpdatedAt?: string | null;
  scannedImages: string[];
  skippedImages: { image: string; reason: string; benign?: boolean }[];
  errors: string[];
  truncated: boolean;
}

export interface AnalysisResult {
  _id: string;
  filename: string;
  originalSize: number;
  optimizedSize: number;
  savingsPercent: number;
  stages: BuildStage[];
  vulnerabilities: SecurityVulnerability[];
  misconfigurations?: Misconfiguration[];
  scanSummary?: ScanSummary;
  scanner?: ScannerInfo;
  optimizedDockerfile: string;
  aiInsights: string;
  layerOptimizations: LayerOptimization[];
  createdAt: string;
  status: 'pending' | 'analyzing' | 'complete' | 'error';
}

export interface AnalysisListItem {
  _id: string;
  filename: string;
  originalSize: number;
  optimizedSize: number;
  savingsPercent: number;
  scanSummary?: ScanSummary;
  scanner?: ScannerInfo;
  aiInsights?: string;
  createdAt: string;
  status: AnalysisResult['status'];
  source: 'web' | 'vscode';
  favorite: boolean;
  optimizationScore: number;
  securityScore: number;
}

export interface HistoryQuery {
  q?: string;
  source?: 'all' | 'web' | 'vscode';
  favorite?: boolean;
  sort?: 'newest' | 'oldest' | 'savings' | 'score';
  page?: number;
  pageSize?: number;
}

export interface HistoryPage {
  items: AnalysisListItem[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface LayerOptimization {
  before: string;
  after: string;
  savedBytes: number;
  reason: string;
}

export type ModelStatus = 'available' | 'busy' | 'unavailable' | 'unknown';

export interface AiModel {
  id: string;
  label: string;
  isDefault: boolean;
  status: ModelStatus;
  reason: string;
  latencyMs: number | null;
}

export interface ModelCatalog {
  models: AiModel[];
  default: string;
  probed: boolean;
  error: string | null;
}

export interface User {
  id: string;
  username: string;
  email: string;
  avatar?: string | null;
  createdAt: string;
}

export interface Session {
  token: string;
  tokenType: string;
  expiresIn: number;
  refreshToken: string;
  sessionId: string;
  user: User;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface DeviceRequest {
  userCode: string;
  client: {
    kind: 'web' | 'vscode' | 'cli' | 'unknown';
    name: string;
    version: string;
    platform: string;
  };
  requestedAt: string;
  expiresAt: string;
}

export interface ConnectedSession {
  id: string;
  client: DeviceRequest['client'];
  ip: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

export interface ApiKey {
  id: string;
  name: string;
  display: string;
  createdAt: string;
  lastUsedAt: string | null;
}
