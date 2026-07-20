
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

export interface SecurityVulnerability {
  id: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  package: string;
  description: string;
  fixedVersion?: string;
}

export interface AnalysisResult {
  _id: string;
  filename: string;
  originalSize: number;
  optimizedSize: number;
  savingsPercent: number;
  stages: BuildStage[];
  vulnerabilities: SecurityVulnerability[];
  optimizedDockerfile: string;
  aiInsights: string;
  layerOptimizations: LayerOptimization[];
  createdAt: string;
  status: 'pending' | 'analyzing' | 'complete' | 'error';
}

export interface LayerOptimization {
  before: string;
  after: string;
  savedBytes: number;
  reason: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}
