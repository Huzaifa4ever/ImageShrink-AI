import * as vscode from 'vscode';

import type { Severity } from './rules/catalog';

export type DiagnosticsSeverity = 'error' | 'warning' | 'information' | 'hint';

function section(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('imageshrink');
}

export const config = {
  autoAnalysis: (): boolean => section().get('enableAutoAnalysis', true),
  analyzeOnSave: (): boolean => section().get('analyzeOnSave', true),
  analyzeWhileTyping: (): boolean => section().get('analyzeWhileTyping', true),

  minimumSeverity: (): Severity => section().get('minimumSeverity', 'info') as Severity,
  diagnosticsSeverity: (): DiagnosticsSeverity =>
    section().get('diagnosticsSeverity', 'warning') as DiagnosticsSeverity,

  debounceMs: (): number => {
    const value = section().get('debounceMs', 400);
    return Math.min(5000, Math.max(100, value));
  },

  trivyEnabled: (): boolean => section().get('security.enabled', true),
  trivyPath: (): string => section().get('security.trivyPath', 'trivy').trim() || 'trivy',
  trivySeverities: (): string =>
    section().get('security.severities', 'CRITICAL,HIGH,MEDIUM,LOW').trim(),
  trivyTimeoutSeconds: (): number => Math.max(10, section().get('security.timeoutSeconds', 120)),
  trivyMaxImages: (): number => Math.max(1, section().get('security.maxImages', 4)),
  trivyMaxFindings: (): number => Math.max(1, section().get('security.maxFindings', 100)),
  trivyCacheMinutes: (): number => Math.max(0, section().get('security.cacheMinutes', 60)),

  useDockerForSizes: (): boolean => section().get('size.useDocker', true),

  onChange: (listener: () => void): vscode.Disposable =>
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('imageshrink')) listener();
    }),
};
