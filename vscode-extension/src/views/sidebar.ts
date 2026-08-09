import * as vscode from 'vscode';

import type { LocalAnalysis, SizeEstimate } from '../analysis/types';
import type { Finding, Severity } from '../rules/catalog';
import type { AnalysisState } from '../state';

const SEVERITY_ICON: Record<Severity, vscode.ThemeIcon> = {
  critical: new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground')),
  high: new vscode.ThemeIcon('warning', new vscode.ThemeColor('editorWarning.foreground')),
  medium: new vscode.ThemeIcon('info', new vscode.ThemeColor('editorInfo.foreground')),
  low: new vscode.ThemeIcon('lightbulb'),
  info: new vscode.ThemeIcon('comment'),
};

export function formatMb(mb: number | null): string {
  if (mb === null) return 'unknown';
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

function scoreBar(score: number): string {
  const filled = Math.round(score / 10);
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)} ${score}/100`;
}

function scoreIcon(score: number): vscode.ThemeIcon {
  if (score >= 80) return new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
  if (score >= 50) {
    return new vscode.ThemeIcon('warning', new vscode.ThemeColor('editorWarning.foreground'));
  }
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

function sizeRows(size: SizeEstimate): vscode.TreeItem[] {
  if (size.totalMb === null) {
    return [
      new Row(
        'Image size',
        'unknown base image',
        new vscode.ThemeIcon('question'),
        `ImageShrink does not have a size on file for ${size.baseImage ?? 'this base image'}, so it cannot estimate the total.`
      ),
    ];
  }

  const label =
    size.baseConfidence === 'measured'
      ? 'measured base + estimated layers'
      : 'estimate';

  const rows: vscode.TreeItem[] = [
    new Row(
      'Image size',
      `${formatMb(size.totalMb)} → ${formatMb(size.optimizedMb)}`,
      new vscode.ThemeIcon('package'),
      new vscode.MarkdownString(
        `**${formatMb(size.baseMb)}** base image (${size.baseConfidence})\n\n` +
          `**+${formatMb(size.addedMb)}** from RUN and COPY instructions (estimated)\n\n` +
          `Applying every available fix would bring this to about **${formatMb(size.optimizedMb)}**.\n\n` +
          `_These are ${label}s, not a measurement of a real build. Build both images to compare for certain._`
      )
    ),
  ];

  if (size.savedMb > 0) {
    rows.push(
      new Row('Potential saving', `${formatMb(size.savedMb)} · ${size.savingsPercent}%`, new vscode.ThemeIcon('arrow-down'))
    );
  }

  return rows;
}

export class OverviewProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
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
      return [new Row('Open a Dockerfile to see its scores', undefined, new vscode.ThemeIcon('info'))];
    }

    const uri = editor.document.uri;
    const scores = this.state.scores(uri);
    const analysis = this.state.analysis(uri);

    const rows: vscode.TreeItem[] = [
      new Row(
        'Optimization',
        scoreBar(scores.optimizationScore),
        scoreIcon(scores.optimizationScore),
        'How well optimized this Dockerfile is. Every point lost traces to a finding below.'
      ),
      new Row('Security', scoreBar(scores.securityScore), scoreIcon(scores.securityScore)),
      new Row('Performance', scoreBar(scores.performanceScore), scoreIcon(scores.performanceScore)),
    ];

    if (analysis) {
      rows.push(...sizeRows(analysis.size), ...this.scanRows(analysis));

      const report = new Row('Open full report', undefined, new vscode.ThemeIcon('graph'));
      report.command = { command: 'imageshrink.showReport', title: 'Show report' };
      rows.push(report);
    } else {
      if (scores.estimatedSavingsMb > 0) {
        rows.push(
          new Row(
            'Potential saving',
            formatMb(scores.estimatedSavingsMb),
            new vscode.ThemeIcon('arrow-down'),
            'Sum of the estimated savings of the findings below. Run a full analysis for a size estimate and a security scan.'
          )
        );
      }

      const analyse = new Row('Run full analysis', 'size + security scan', new vscode.ThemeIcon('search-fuzzy'));
      analyse.command = { command: 'imageshrink.analyzeDockerfile', title: 'Analyze' };
      rows.push(analyse);
    }

    return rows;
  }

  private scanRows(analysis: LocalAnalysis): vscode.TreeItem[] {
    const { scan } = analysis;

    if (scan.status === 'disabled') {
      return [new Row('Security scan', 'turned off', new vscode.ThemeIcon('circle-slash'))];
    }
    if (scan.status === 'notRun') return [];

    if (scan.status === 'unavailable') {
      const row = new Row(
        'Security scan',
        'unavailable',
        new vscode.ThemeIcon('warning', new vscode.ThemeColor('editorWarning.foreground')),
        scan.reason
      );
      row.command = { command: 'imageshrink.installTrivy', title: 'How to enable' };
      return [row];
    }

    const { summary } = scan;
    if (summary.total === 0) {
      return [
        new Row(
          'Vulnerabilities',
          'none found',
          new vscode.ThemeIcon('shield', new vscode.ThemeColor('testing.iconPassed')),
          `Scanned: ${scan.scannedImages.join(', ') || 'nothing'}`
        ),
      ];
    }

    return [
      new Row(
        'Vulnerabilities',
        `${summary.critical} critical · ${summary.high} high · ${summary.medium} medium`,
        new vscode.ThemeIcon(
          'shield',
          summary.critical > 0 ? new vscode.ThemeColor('errorForeground') : undefined
        ),
        new vscode.MarkdownString(
          `${summary.total} unique CVEs across ${scan.scannedImages.length} base image(s).\n\n` +
            `${summary.fixable} have a fixed version available.\n\n` +
            `Scanned with Trivy ${scan.version ?? ''}.`
        )
      ),
    ];
  }
}

class FindingRow extends vscode.TreeItem {
  constructor(finding: Finding, uri: vscode.Uri) {
    super(finding.title, vscode.TreeItemCollapsibleState.None);

    this.description = `line ${finding.line}${finding.savingsMb > 0 ? ` · ~${formatMb(finding.savingsMb)}` : ''}`;
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

    return findings.map((finding) => new FindingRow(finding, editor.document.uri));
  }
}

class VulnerabilityRow extends vscode.TreeItem {
  constructor(cve: LocalAnalysis['scan']['vulnerabilities'][number]) {
    super(cve.cveId, vscode.TreeItemCollapsibleState.None);

    const fixed = cve.packages.find((p) => p.fixedVersion)?.fixedVersion;
    this.description = `${cve.severity}${fixed ? ` · fix ${fixed}` : ''}`;
    this.iconPath =
      cve.severity === 'critical' || cve.severity === 'high'
        ? new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'))
        : new vscode.ThemeIcon('warning');

    const tooltip = new vscode.MarkdownString('', true);
    tooltip.appendMarkdown(`**${cve.title}**\n\n${cve.description}\n\n`);
    tooltip.appendMarkdown(
      `Affects: ${cve.packages.map((p) => `\`${p.name} ${p.installedVersion}\``).join(', ')}\n\n`
    );
    tooltip.appendMarkdown(`In image \`${cve.image}\``);
    this.tooltip = tooltip;

    if (cve.referenceUrl) {
      this.command = {
        command: 'vscode.open',
        title: 'Open advisory',
        arguments: [vscode.Uri.parse(cve.referenceUrl)],
      };
    }
  }
}

export class SecurityProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
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

    const analysis = this.state.analysis(editor.document.uri);
    if (!analysis) {
      const row = new Row('Run a full analysis to scan', undefined, new vscode.ThemeIcon('search-fuzzy'));
      row.command = { command: 'imageshrink.analyzeDockerfile', title: 'Analyze' };
      return [row];
    }

    const { scan } = analysis;

    if (scan.status === 'disabled') {
      return [new Row('Scanning is turned off', undefined, new vscode.ThemeIcon('circle-slash'))];
    }

    if (scan.status === 'unavailable') {
      const row = new Row('Trivy not found', undefined, new vscode.ThemeIcon('warning'), scan.reason);
      row.command = { command: 'imageshrink.installTrivy', title: 'How to install' };
      return [row];
    }

    const rows: vscode.TreeItem[] = [];

    if (scan.status === 'partial') {
      rows.push(new Row('Partial scan', scan.reason, new vscode.ThemeIcon('warning')));
    }

    if (!scan.vulnerabilities.length) {
      rows.push(
        new Row(
          'No known vulnerabilities',
          scan.scannedImages.join(', '),
          new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'))
        )
      );
    } else {
      rows.push(...scan.vulnerabilities.map((cve) => new VulnerabilityRow(cve)));
    }

    for (const skipped of scan.skippedImages) {
      rows.push(
        new Row(skipped.image, `skipped — ${skipped.reason}`, new vscode.ThemeIcon('circle-slash'))
      );
    }

    return rows;
  }
}
