

import * as vscode from 'vscode';

import type { Severity } from './rules/catalog';

export type DiagnosticsSeverity = 'error' | 'warning' | 'information' | 'hint';

function section(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('imageshrink');
}

export const config = {
  localRulesOnly: (): boolean => section().get('useLocalRulesOnly', false),

  aiSuggestions: (): boolean => section().get('enableAiSuggestions', true),
  autoAnalysis: (): boolean => section().get('enableAutoAnalysis', true),
  analyzeOnSave: (): boolean => section().get('analyzeOnSave', true),
  analyzeWhileTyping: (): boolean => section().get('analyzeWhileTyping', true),
  useAiBackend: (): boolean => section().get('useAiBackend', true),
  sendWorkspaceContext: (): boolean => section().get('sendWorkspaceContext', true),
  telemetry: (): boolean => section().get('telemetry', false),

  apiUrl: (): string => section().get('apiUrl', 'http://localhost:8000/api/v1').replace(/\/+$/, ''),
  webUrl: (): string => section().get('webUrl', 'http://localhost:5173').replace(/\/+$/, ''),
  model: (): string => section().get('model', '').trim(),

  minimumSeverity: (): Severity => section().get('minimumSeverity', 'info') as Severity,
  diagnosticsSeverity: (): DiagnosticsSeverity =>
    section().get('diagnosticsSeverity', 'warning') as DiagnosticsSeverity,
  debounceMs: (): number => {
    const value = section().get('debounceMs', 400);
    return Math.min(5000, Math.max(100, value));
  },

  networkAllowed: (): boolean => !config.localRulesOnly(),

  aiAllowed: (): boolean =>
    config.networkAllowed() && config.useAiBackend() && config.aiSuggestions(),

  onChange: (listener: () => void): vscode.Disposable =>
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('imageshrink')) listener();
    }),
};
