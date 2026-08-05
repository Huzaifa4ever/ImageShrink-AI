
import * as vscode from 'vscode';

import type { Finding, Severity } from '../rules/catalog';
import type { AnalysisState } from '../state';
import { toRange } from '../util/position';

const SEVERITY_BADGE: Record<Severity, string> = {
  critical: '$(error) Critical',
  high: '$(warning) High',
  medium: '$(info) Medium',
  low: '$(lightbulb) Low',
  info: '$(comment) Info',
};

function formatMb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

function renderHover(findings: Finding[]): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString('', true);
  markdown.supportThemeIcons = true;
  markdown.isTrusted = true;

  findings.forEach((finding, index) => {
    if (index > 0) markdown.appendMarkdown('\n\n---\n\n');

    markdown.appendMarkdown(`**${SEVERITY_BADGE[finding.severity]} · ${finding.title}**\n\n`);
    markdown.appendMarkdown(`${finding.problem}\n\n`);
    markdown.appendMarkdown(`${finding.explanation}\n\n`);

    if (finding.detail) markdown.appendMarkdown(`${finding.detail}\n\n`);

    const rows: string[] = [];
    if (finding.sizeImpactMb > 0) {
      rows.push(`| Image cost | ~${formatMb(finding.sizeImpactMb)} (estimate) |`);
    }
    if (finding.savingsMb > 0) {
      rows.push(`| Estimated saving | ~${formatMb(finding.savingsMb)} |`);
    }
    if (finding.compatibility !== null) {
      rows.push(`| Compatibility | ~${finding.compatibility}% likely drop-in |`);
    }
    if (finding.suggestedImage) {
      rows.push(`| Suggested | \`${finding.suggestedImage}\` |`);
    }
    if (rows.length) {
      markdown.appendMarkdown(`| | |\n|---|---|\n${rows.join('\n')}\n\n`);
    }

    if (finding.securityImpact) {
      markdown.appendMarkdown(`**Security** - ${finding.securityImpact}\n\n`);
    }
    if (finding.performanceImpact) {
      markdown.appendMarkdown(`**Performance** - ${finding.performanceImpact}\n\n`);
    }

    if (finding.autoFixable) {
      markdown.appendMarkdown('$(lightbulb) A quick fix is available.  ');
    }
    markdown.appendMarkdown(`[Documentation](${finding.docsUrl}) · \`${finding.ruleId}\``);
  });

  return markdown;
}

export class ImageShrinkHoverProvider implements vscode.HoverProvider {
  constructor(private readonly state: AnalysisState) {}

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.Hover | undefined {
    const findings = this.state.findings(document.uri).filter((finding) => {
      const range = toRange(finding, document);
      if (range.isEmpty) return position.line === range.start.line;
      return range.contains(position);
    });

    if (!findings.length) return undefined;

    const ranges = findings.map((finding) => toRange(finding, document));
    const hoverRange = ranges.reduce((widest, current) => widest.union(current));

    return new vscode.Hover(renderHover(findings), hoverRange);
  }
}
