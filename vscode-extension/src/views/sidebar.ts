

import * as vscode from 'vscode';

import type { ApiClient } from '../api/client';
import { NetworkDisabled, NotSignedIn } from '../api/client';
import type { AnalysisListItem, Stats } from '../api/types';
import type { SessionStore } from '../auth/session';
import { config } from '../config';
import { log } from '../logger';
import type { Finding, Severity } from '../rules/catalog';
import type { AnalysisState } from '../state';

const SEVERITY_ICON: Record<Severity, vscode.ThemeIcon> = {
  critical: new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground')),
  high: new vscode.ThemeIcon('warning', new vscode.ThemeColor('editorWarning.foreground')),
  medium: new vscode.ThemeIcon('info', new vscode.ThemeColor('editorInfo.foreground')),
  low: new vscode.ThemeIcon('lightbulb'),
  info: new vscode.ThemeIcon('comment'),
};

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${Math.round(mb)} MB`;
}
function scoreBar(score: number): string {
  const filled = Math.round(score / 10);
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)} ${score}/100`;
}

function scoreIcon(score: number): vscode.ThemeIcon {
  if (score >= 80) return new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
  if (score >= 50) return new vscode.ThemeIcon('warning', new vscode.ThemeColor('editorWarning.foreground'));
  return new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
}

class Row extends vscode.TreeItem {
  constructor(
    label: string,
    description?: string,
    icon?: vscode.ThemeIcon,
    tooltip?: string | vscode.MarkdownString
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    if (description !== undefined) this.description = description;
    if (icon) this.iconPath = icon;
    if (tooltip) this.tooltip = tooltip;
  }
}


export class OverviewProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(
    private readonly state: AnalysisState,
    private readonly session: SessionStore
  ) {
    this.state.onDidChange(() => this.refresh());
    this.session.onDidChangeSession(() => this.refresh());
    vscode.window.onDidChangeActiveTextEditor(() => this.refresh());
  }

  refresh(): void {
    this.changeEmitter.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'dockerfile') {
      return [new Row('Open a Dockerfile to see its scores', undefined, new vscode.ThemeIcon('info'))];
    }

    const uri = editor.document.uri;
    const scores = this.state.scores(uri);
    const result = this.state.result(uri);
    const rows: vscode.TreeItem[] = [];

    rows.push(
      new Row(
        'Optimization',
        scoreBar(scores.optimizationScore),
        scoreIcon(scores.optimizationScore),
        'How well optimized this Dockerfile is, from the built-in rules. Every point lost traces to a finding below.'
      ),
      new Row('Security', scoreBar(scores.securityScore), scoreIcon(scores.securityScore)),
      new Row('Performance', scoreBar(scores.performanceScore), scoreIcon(scores.performanceScore))
    );

    if (result) {
      rows.push(
        new Row(
          'Image size',
          `${formatBytes(result.originalSize)} → ${formatBytes(result.optimizedSize)}`,
          new vscode.ThemeIcon('package'),
          `Estimated by the AI, with ${result.confidence}% stated confidence. These are estimates, not measurements of a real build.`
        ),
        new Row(
          'Estimated saving',
          `${result.savingsPercent}%`,
          new vscode.ThemeIcon('arrow-down')
        )
      );

      if (result.scanSummary && result.scanSummary.total > 0) {
        const summary = result.scanSummary;
        rows.push(
          new Row(
            'Vulnerabilities',
            `${summary.critical} critical · ${summary.high} high · ${summary.medium} medium`,
            summary.critical > 0
              ? new vscode.ThemeIcon('shield', new vscode.ThemeColor('errorForeground'))
              : new vscode.ThemeIcon('shield')
          )
        );
      }

      const report = new Row(
        'Open full report',
        result.modelUsed,
        new vscode.ThemeIcon('graph'),
        'Show the AI rewrite, layer breakdown and CVE list.'
      );
      report.command = { command: 'imageshrink.showReport', title: 'Show report' };
      rows.push(report);
    } else if (scores.estimatedSavingsMb > 0) {
      rows.push(
        new Row(
          'Potential saving',
          `~${scoreBarFreeMb(scores.estimatedSavingsMb)}`,
          new vscode.ThemeIcon('arrow-down'),
          'Sum of the estimated savings of the findings below. Run a full analysis for an AI estimate of the whole image.'
        )
      );
    }

    if (!result) {
      const analyze = new Row(
        config.aiAllowed() ? 'Run full AI analysis' : 'AI analysis is off',
        config.aiAllowed() ? undefined : 'local rules only',
        new vscode.ThemeIcon('sparkle')
      );
      if (config.aiAllowed()) {
        analyze.command = { command: 'imageshrink.analyzeDockerfile', title: 'Analyze' };
      } else {
        analyze.command = { command: 'imageshrink.openSettings', title: 'Settings' };
      }
      rows.push(analyze);
    }

    const account = new Row(
      this.session.isSignedIn ? (this.session.user?.username ?? 'Signed in') : 'Not signed in',
      this.session.isSignedIn ? undefined : 'sign in for AI analysis',
      new vscode.ThemeIcon(this.session.isSignedIn ? 'account' : 'sign-in')
    );
    account.command = {
      command: this.session.isSignedIn ? 'imageshrink.signOut' : 'imageshrink.signIn',
      title: 'Account',
    };
    rows.push(account);

    return rows;
  }
}

function scoreBarFreeMb(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
}

class FindingRow extends vscode.TreeItem {
  constructor(finding: Finding, uri: vscode.Uri) {
    super(finding.title, vscode.TreeItemCollapsibleState.None);

    this.description = `line ${finding.line}${finding.savingsMb > 0 ? ` · ~${scoreBarFreeMb(finding.savingsMb)}` : ''}`;
    this.iconPath = SEVERITY_ICON[finding.severity];

    const tooltip = new vscode.MarkdownString('', true);
    tooltip.supportThemeIcons = true;
    tooltip.appendMarkdown(`**${finding.problem}**\n\n${finding.explanation}`);
    if (finding.autoFixable) tooltip.appendMarkdown('\n\n$(lightbulb) Quick fix available.');
    this.tooltip = tooltip;

    this.command = {
      command: 'imageshrink.openFinding',
      title: 'Go to finding',
      arguments: [uri, finding.line, finding.column],
    };
    this.contextValue = finding.autoFixable ? 'fixableFinding' : 'finding';
  }
}

export class SuggestionsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(private readonly state: AnalysisState) {
    this.state.onDidChange(() => this.refresh());
    vscode.window.onDidChangeActiveTextEditor(() => this.refresh());
  }

  refresh(): void {
    this.changeEmitter.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'dockerfile') {
      return [new Row('Open a Dockerfile', undefined, new vscode.ThemeIcon('info'))];
    }

    const findings = this.state.findings(editor.document.uri);
    if (!findings.length) {
      return [
        new Row(
          'No findings',
          'this Dockerfile looks good',
          new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'))
        ),
      ];
    }

    // Already sorted by severity then position by the engine.
    return findings.map((finding) => new FindingRow(finding, editor.document.uri));
  }
}

class HistoryRow extends vscode.TreeItem {
  constructor(item: AnalysisListItem) {
    super(item.filename, vscode.TreeItemCollapsibleState.None);

    const when = new Date(item.createdAt);
    const saved = item.originalSize - item.optimizedSize;
    this.description = `${item.savingsPercent}% smaller · ${when.toLocaleDateString()}`;
    this.iconPath = new vscode.ThemeIcon(item.source === 'vscode' ? 'vscode' : 'globe');

    const tooltip = new vscode.MarkdownString('', true);
    tooltip.appendMarkdown(
      `**${item.filename}**\n\n` +
        `Saved about ${formatBytes(saved)} (${item.savingsPercent}%)\n\n` +
        `Optimization ${item.optimizationScore}/100 · Security ${item.securityScore}/100\n\n` +
        `From ${item.source === 'vscode' ? 'VS Code' : 'the web app'} on ${when.toLocaleString()}`
    );
    this.tooltip = tooltip;

    this.command = {
      command: 'imageshrink.openHistoryItem',
      title: 'Open analysis',
      arguments: [item._id],
    };
    this.contextValue = 'historyItem';
  }
}

export class HistoryProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  private cache: { items: AnalysisListItem[]; stats: Stats | undefined } | undefined;
  private loading = false;

  constructor(
    private readonly client: ApiClient,
    private readonly session: SessionStore
  ) {
    this.session.onDidChangeSession(() => {
      this.cache = undefined;
      this.refresh();
    });
  }

  refresh(): void {
    this.cache = undefined;
    this.changeEmitter.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<vscode.TreeItem[]> {
    if (!config.networkAllowed()) {
      return [
        new Row(
          'History is unavailable',
          'local rules only',
          new vscode.ThemeIcon('circle-slash'),
          'History lives in your ImageShrink account. Turn off "Use Local Rules Only" to sync it.'
        ),
      ];
    }

    if (!this.session.isSignedIn) {
      const signIn = new Row('Sign in to see your history', undefined, new vscode.ThemeIcon('sign-in'));
      signIn.command = { command: 'imageshrink.signIn', title: 'Sign in' };
      return [signIn];
    }

    if (this.cache) return this.rows(this.cache);
    if (this.loading) return [new Row('Loading…', undefined, new vscode.ThemeIcon('loading~spin'))];

    this.loading = true;
    try {
      // Both in one go, so the summary row and the list cannot disagree.
      const [page, stats] = await Promise.all([
        this.client.history({ pageSize: 15 }),
        this.client.stats().catch(() => undefined),
      ]);
      this.cache = { items: page.items, stats };
      return this.rows(this.cache);
    } catch (error) {
      if (error instanceof NotSignedIn || error instanceof NetworkDisabled) {
        return [new Row(error.message, undefined, new vscode.ThemeIcon('sign-in'))];
      }
      log.warn(`history unavailable: ${(error as Error).message}`);
      const retry = new Row(
        'Could not load history',
        (error as Error).message,
        new vscode.ThemeIcon('warning')
      );
      retry.command = { command: 'imageshrink.refresh', title: 'Retry' };
      return [retry];
    } finally {
      this.loading = false;
    }
  }

  private rows(cache: { items: AnalysisListItem[]; stats: Stats | undefined }): vscode.TreeItem[] {
    const rows: vscode.TreeItem[] = [];

    if (cache.stats && cache.stats.total > 0) {
      rows.push(
        new Row(
          `${cache.stats.total} analyses`,
          `${formatBytes(cache.stats.bytesSaved)} saved in total`,
          new vscode.ThemeIcon('graph'),
          `${cache.stats.bySource.vscode} from VS Code, ${cache.stats.bySource.web} from the web app.`
        )
      );
    }

    if (!cache.items.length) {
      rows.push(
        new Row('No analyses yet', 'run one to get started', new vscode.ThemeIcon('info'))
      );
      return rows;
    }

    rows.push(...cache.items.map((item) => new HistoryRow(item)));
    return rows;
  }
}
