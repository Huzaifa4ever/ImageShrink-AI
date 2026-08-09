import * as vscode from 'vscode';

import { config } from '../config';
import { log } from '../logger';
import * as engine from '../rules/engine';
import { meetsSeverity } from '../rules/catalog';
import type { Finding, Severity } from '../rules/catalog';
import type { AnalysisState } from '../state';
import { toRange } from '../util/position';
import { gather } from '../workspace/context';

export const DIAGNOSTIC_SOURCE = 'ImageShrink';
export const DOCKERFILE_SELECTOR: vscode.DocumentSelector = [
  { language: 'dockerfile', scheme: 'file' },
  { language: 'dockerfile', scheme: 'untitled' },
];

export function isDockerfile(document: vscode.TextDocument): boolean {
  return document.languageId === 'dockerfile';
}

const LADDER = [
  vscode.DiagnosticSeverity.Error,
  vscode.DiagnosticSeverity.Warning,
  vscode.DiagnosticSeverity.Information,
  vscode.DiagnosticSeverity.Hint,
];

const CONFIGURED_INDEX: Record<string, number> = {
  error: 0,
  warning: 1,
  information: 2,
  hint: 3,
};

const OFFSET: Record<Severity, number> = {
  critical: 0,
  high: 0,
  medium: 1,
  low: 2,
  info: 3,
};

function diagnosticSeverity(severity: Severity): vscode.DiagnosticSeverity {
  const base = CONFIGURED_INDEX[config.diagnosticsSeverity()] ?? 1;
  return LADDER[Math.min(base + OFFSET[severity], LADDER.length - 1)] ?? vscode.DiagnosticSeverity.Warning;
}
export interface FindingDiagnostic extends vscode.Diagnostic {
  finding?: Finding;
}

function toDiagnostic(finding: Finding, document: vscode.TextDocument): FindingDiagnostic {
  const diagnostic: FindingDiagnostic = new vscode.Diagnostic(
    toRange(finding, document),
    finding.problem,
    diagnosticSeverity(finding.severity)
  );

  diagnostic.source = DIAGNOSTIC_SOURCE;

  diagnostic.code = { value: finding.ruleId, target: vscode.Uri.parse(finding.docsUrl) };
  diagnostic.finding = finding;

  if (finding.savingsMb > 0) {
    diagnostic.tags = undefined;
  }
  return diagnostic;
}

export class DiagnosticsController implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection('imageshrink');
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly state: AnalysisState) {
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((document) => {
        if (isDockerfile(document)) void this.analyzeNow(document);
      }),

      vscode.workspace.onDidChangeTextDocument((event) => {
        if (!isDockerfile(event.document)) return;
        if (!config.autoAnalysis() || !config.analyzeWhileTyping()) return;
        this.schedule(event.document);
      }),

      vscode.workspace.onDidSaveTextDocument((document) => {
        if (!isDockerfile(document)) return;
        if (!config.autoAnalysis() || !config.analyzeOnSave()) return;

        void this.analyzeNow(document);
      }),

      vscode.workspace.onDidCloseTextDocument((document) => {
        this.clearTimer(document.uri);
        this.collection.delete(document.uri);
        this.state.forget(document.uri);
      }),

      config.onChange(() => void this.analyzeAllOpen())
    );

    void this.analyzeAllOpen();
  }

  private clearTimer(uri: vscode.Uri): void {
    const key = uri.toString();
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }

  private schedule(document: vscode.TextDocument): void {
    this.clearTimer(document.uri);
    const key = document.uri.toString();
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        void this.analyzeNow(document);
      }, config.debounceMs())
    );
  }

  async analyzeNow(document: vscode.TextDocument): Promise<Finding[]> {
    if (!isDockerfile(document)) return [];

    try {
      const context = await gather(document.uri);
      const findings = engine.analyze(document.getText(), {
        hasDockerignore: context.hasDockerignore,
        dockerignore: context.dockerignore,
        bloatCandidates: context.bloatCandidates,
      });

      const floor = config.minimumSeverity();
      const visible = findings.filter((finding) => meetsSeverity(finding.severity, floor));

      this.state.setFindings(document.uri, visible, engine.score(findings));
      this.publish(document, visible);
      return visible;
    } catch (error) {
      log.error(`analysis failed for ${document.uri.fsPath}`, error);
      return [];
    }
  }

  publish(document: vscode.TextDocument, findings: Finding[]): void {
    this.collection.set(
      document.uri,
      findings.map((finding) => toDiagnostic(finding, document))
    );
  }

  private async analyzeAllOpen(): Promise<void> {
    await Promise.all(
      vscode.workspace.textDocuments
        .filter(isDockerfile)
        .map((document) => this.analyzeNow(document))
    );
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.collection.dispose();
    for (const disposable of this.disposables) disposable.dispose();
  }
}
