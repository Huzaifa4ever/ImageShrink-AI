import * as vscode from 'vscode';

import type { LocalAnalysis } from './analysis/types';
import type { Finding, Scores } from './rules/catalog';

export interface DocumentState {
  findings: Finding[];
  scores: Scores;

  analysis: LocalAnalysis | undefined;
  updatedAt: number;
}

const EMPTY_SCORES: Scores = {
  optimizationScore: 100,
  securityScore: 100,
  performanceScore: 100,
  findingCount: 0,
  bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
  estimatedSavingsMb: 0,
};

export class AnalysisState {
  private readonly documents = new Map<string, DocumentState>();
  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri | undefined>();

  readonly onDidChange = this.changeEmitter.event;

  get(uri: vscode.Uri): DocumentState | undefined {
    return this.documents.get(uri.toString());
  }

  findings(uri: vscode.Uri): Finding[] {
    return this.get(uri)?.findings ?? [];
  }

  scores(uri: vscode.Uri): Scores {
    return this.get(uri)?.scores ?? EMPTY_SCORES;
  }

  analysis(uri: vscode.Uri): LocalAnalysis | undefined {
    return this.get(uri)?.analysis;
  }

  setFindings(uri: vscode.Uri, findings: Finding[], scores: Scores): void {
    const key = uri.toString();
    const existing = this.documents.get(key);
    this.documents.set(key, {
      findings,
      scores,

      analysis: existing?.analysis,
      updatedAt: Date.now(),
    });
    this.changeEmitter.fire(uri);
  }

  setAnalysis(uri: vscode.Uri, analysis: LocalAnalysis): void {
    this.documents.set(uri.toString(), {
      findings: analysis.findings,
      scores: analysis.scores,
      analysis,
      updatedAt: Date.now(),
    });
    this.changeEmitter.fire(uri);
  }

  forget(uri: vscode.Uri): void {
    if (this.documents.delete(uri.toString())) this.changeEmitter.fire(uri);
  }

  dispose(): void {
    this.documents.clear();
    this.changeEmitter.dispose();
  }
}
