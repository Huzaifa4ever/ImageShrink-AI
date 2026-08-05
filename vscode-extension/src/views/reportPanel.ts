

import * as vscode from 'vscode';

import type { AnalysisResult } from '../api/types';
import type { Finding } from '../rules/catalog';

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function nonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i += 1) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${Math.round(mb)} MB`;
}

function scoreClass(score: number): string {
  if (score >= 80) return 'good';
  if (score >= 50) return 'warn';
  return 'bad';
}

export class ReportPanel {
  private static current: ReportPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private result: AnalysisResult,
    private sourceUri: vscode.Uri
  ) {
    this.panel = vscode.window.createWebviewPanel(
      'imageshrink.report',
      `ImageShrink - ${result.filename}`,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true }
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      (message: { type: string; line?: number }) => {
        if (message.type === 'apply') {
          void vscode.commands.executeCommand('imageshrink.applyOptimized', this.sourceUri);
        }
        if (message.type === 'copy') {
          void vscode.env.clipboard.writeText(this.result.optimizedDockerfile);
          void vscode.window.showInformationMessage('ImageShrink: optimized Dockerfile copied.');
        }
        if (message.type === 'goto' && typeof message.line === 'number') {
          void vscode.commands.executeCommand(
            'imageshrink.openFinding',
            this.sourceUri,
            message.line,
            1
          );
        }
      },
      null,
      this.disposables
    );

    this.render();
  }

  static show(result: AnalysisResult, sourceUri: vscode.Uri): ReportPanel {
    // One panel, reused: a new one per analysis would bury the editor in tabs.
    if (ReportPanel.current) {
      ReportPanel.current.result = result;
      ReportPanel.current.sourceUri = sourceUri;
      ReportPanel.current.panel.title = `ImageShrink - ${result.filename}`;
      ReportPanel.current.render();
      ReportPanel.current.panel.reveal(vscode.ViewColumn.Beside, true);
      return ReportPanel.current;
    }

    ReportPanel.current = new ReportPanel(result, sourceUri);
    return ReportPanel.current;
  }

  private render(): void {
    this.panel.webview.html = this.html();
  }

  private findingsSection(findings: Finding[]): string {
    if (!findings.length) {
      return '<p class="empty">No rule findings - this Dockerfile follows the built-in best practices.</p>';
    }

    return `<ul class="findings">${findings
      .map(
        (finding) => `
        <li class="finding sev-${escapeHtml(finding.severity)}">
          <div class="finding-head">
            <span class="badge">${escapeHtml(finding.severity)}</span>
            <button class="linkish" data-line="${finding.line}">${escapeHtml(finding.title)}</button>
            <span class="muted">line ${finding.line}</span>
            ${finding.savingsMb > 0 ? `<span class="saving">~${escapeHtml(finding.savingsMb)} MB</span>` : ''}
          </div>
          <p>${escapeHtml(finding.problem)}</p>
          ${finding.detail ? `<p class="muted">${escapeHtml(finding.detail)}</p>` : ''}
        </li>`
      )
      .join('')}</ul>`;
  }

  private layersSection(): string {
    const layers = this.result.layerOptimizations ?? [];
    if (!layers.length) return '';

    return `
      <h2>Layer changes</h2>
      <table>
        <thead><tr><th>Before</th><th>After</th><th>Saved</th></tr></thead>
        <tbody>
          ${layers
            .map(
              (layer) => `<tr>
                <td><code>${escapeHtml(layer.before)}</code></td>
                <td><code>${escapeHtml(layer.after)}</code></td>
                <td class="nowrap">${escapeHtml(formatBytes(layer.savedBytes))}</td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>`;
  }

  private vulnerabilitiesSection(): string {
    const summary = this.result.scanSummary;
    if (!summary || summary.total === 0) {
      return '<h2>Security scan</h2><p class="empty">No vulnerabilities reported for the base images.</p>';
    }

    return `
      <h2>Security scan</h2>
      <div class="chips">
        <span class="chip bad">${summary.critical} critical</span>
        <span class="chip warn">${summary.high} high</span>
        <span class="chip">${summary.medium} medium</span>
        <span class="chip">${summary.low} low</span>
        ${summary.fixable > 0 ? `<span class="chip good">${summary.fixable} fixable</span>` : ''}
      </div>
      <p class="muted">${escapeHtml(summary.total)} unique CVEs across the scanned base images.
      ${summary.displayed < summary.total ? `Showing the ${summary.displayed} most severe.` : ''}</p>`;
  }

  private schedulingNote(): string {
    const scheduling = this.result.scheduling;
    if (!scheduling?.fellBack) return '';

    const reasons = scheduling.attempts
      .map((attempt) => `${escapeHtml(attempt.model)} (${escapeHtml(attempt.reason)})`)
      .join(', ');
    return `<div class="notice">
      Analysed with <strong>${escapeHtml(scheduling.model)}</strong> instead of
      <strong>${escapeHtml(this.result.modelRequested)}</strong>, which was unavailable.
      ${reasons ? `Tried: ${reasons}.` : ''}
    </div>`;
  }

  private html(): string {
    const n = nonce();
    const csp =
      `default-src 'none'; style-src 'nonce-${n}'; script-src 'nonce-${n}';`;

    const r = this.result;
    const savedBytes = r.originalSize - r.optimizedSize;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>ImageShrink report</title>
<style nonce="${n}">
  :root { color-scheme: light dark; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 1.25rem 1.5rem 3rem;
    line-height: 1.55;
  }
  h1 { font-size: 1.25rem; margin: 0 0 .25rem; }
  h2 { font-size: 1rem; margin: 2rem 0 .6rem; padding-bottom: .3rem;
       border-bottom: 1px solid var(--vscode-panel-border); }
  p { margin: .4rem 0; }
  code { font-family: var(--vscode-editor-font-family); font-size: .88em; }
  .muted { color: var(--vscode-descriptionForeground); }
  .empty { color: var(--vscode-descriptionForeground); font-style: italic; }
  .nowrap { white-space: nowrap; }

  .scores { display: flex; flex-wrap: wrap; gap: .75rem; margin: 1rem 0; }
  .score { flex: 1 1 8rem; border: 1px solid var(--vscode-panel-border);
           border-radius: 6px; padding: .7rem .8rem; }
  .score .value { font-size: 1.5rem; font-weight: 600; }
  .score .label { font-size: .75rem; text-transform: uppercase;
                  letter-spacing: .06em; color: var(--vscode-descriptionForeground); }
  .good { color: var(--vscode-testing-iconPassed, #4ADE80); }
  .warn { color: var(--vscode-editorWarning-foreground, #FBBF24); }
  .bad  { color: var(--vscode-errorForeground, #FF6B6B); }

  .sizes { display: flex; align-items: baseline; gap: .6rem; font-size: 1.05rem; margin: .6rem 0; }
  .sizes .arrow { color: var(--vscode-descriptionForeground); }

  .actions { display: flex; gap: .5rem; margin: 1rem 0; flex-wrap: wrap; }
  button {
    font-family: inherit; font-size: .85rem; padding: .45rem .9rem; border-radius: 4px;
    border: 1px solid var(--vscode-button-border, transparent);
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    cursor: pointer;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground);
                     color: var(--vscode-button-secondaryForeground); }
  button.linkish { background: none; border: none; padding: 0; color: var(--vscode-textLink-foreground);
                   cursor: pointer; font-size: inherit; text-align: left; }
  button.linkish:hover { text-decoration: underline; background: none; }

  pre { background: var(--vscode-textCodeBlock-background); padding: .8rem;
        border-radius: 6px; overflow-x: auto; max-height: 26rem; }

  table { width: 100%; border-collapse: collapse; font-size: .85rem; display: block; overflow-x: auto; }
  th, td { text-align: left; padding: .45rem .6rem; border-bottom: 1px solid var(--vscode-panel-border);
           vertical-align: top; }
  th { color: var(--vscode-descriptionForeground); font-weight: 600; }

  .chips { display: flex; gap: .4rem; flex-wrap: wrap; margin: .5rem 0; }
  .chip { font-size: .75rem; padding: .15rem .5rem; border-radius: 999px;
          border: 1px solid var(--vscode-panel-border); }

  .findings { list-style: none; padding: 0; margin: .5rem 0; }
  .finding { border-left: 3px solid var(--vscode-panel-border); padding: .5rem .8rem; margin-bottom: .6rem; }
  .finding.sev-critical { border-left-color: var(--vscode-errorForeground, #FF6B6B); }
  .finding.sev-high { border-left-color: var(--vscode-editorWarning-foreground, #FBBF24); }
  .finding-head { display: flex; align-items: baseline; gap: .5rem; flex-wrap: wrap; }
  .badge { font-size: .68rem; text-transform: uppercase; letter-spacing: .06em;
           padding: .1rem .4rem; border-radius: 3px; border: 1px solid var(--vscode-panel-border); }
  .saving { font-size: .75rem; color: var(--vscode-testing-iconPassed, #4ADE80); }

  .notice { border: 1px solid var(--vscode-editorWarning-foreground, #FBBF24);
            border-radius: 6px; padding: .6rem .8rem; margin: 1rem 0; font-size: .87rem; }
</style>
</head>
<body>
  <h1>${escapeHtml(r.filename)}</h1>
  <p class="muted">Analysed with ${escapeHtml(r.modelUsed || 'the built-in rules')} ·
     ${escapeHtml(new Date(r.createdAt).toLocaleString())}
     ${r.saved ? '· saved to your history' : '· not saved'}</p>

  ${this.schedulingNote()}

  <div class="scores">
    <div class="score"><div class="value ${scoreClass(r.optimizationScore)}">${r.optimizationScore}</div><div class="label">Optimization</div></div>
    <div class="score"><div class="value ${scoreClass(r.securityScore)}">${r.securityScore}</div><div class="label">Security</div></div>
    <div class="score"><div class="value ${scoreClass(r.performanceScore)}">${r.performanceScore}</div><div class="label">Performance</div></div>
    <div class="score"><div class="value">${r.savingsPercent}%</div><div class="label">Est. reduction</div></div>
  </div>

  <div class="sizes">
    <strong>${escapeHtml(formatBytes(r.originalSize))}</strong>
    <span class="arrow">→</span>
    <strong class="good">${escapeHtml(formatBytes(r.optimizedSize))}</strong>
    <span class="muted">saves about ${escapeHtml(formatBytes(savedBytes))}</span>
  </div>
  <p class="muted">Sizes are the model's estimates, stated at ${r.confidence}% confidence - not a
     measurement of a real build. Build both images to compare for certain.</p>

  ${r.aiInsights ? `<h2>Summary</h2><p>${escapeHtml(r.aiInsights)}</p>` : ''}

  <h2>Optimized Dockerfile</h2>
  <div class="actions">
    <button id="apply">Apply to editor</button>
    <button id="copy" class="secondary">Copy</button>
  </div>
  <pre><code>${escapeHtml(r.optimizedDockerfile)}</code></pre>

  ${this.layersSection()}

  <h2>Findings (${r.ruleFindings?.length ?? 0})</h2>
  ${this.findingsSection(r.ruleFindings ?? [])}

  ${this.vulnerabilitiesSection()}

  ${
    r.securityNotes?.length
      ? `<h2>AI security notes</h2><ul>${r.securityNotes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul>`
      : ''
  }
  ${
    r.dockerignoreSuggestions?.length
      ? `<h2>Suggested .dockerignore entries</h2><pre><code>${escapeHtml(r.dockerignoreSuggestions.join('\n'))}</code></pre>`
      : ''
  }

<script nonce="${n}">
  const vscodeApi = acquireVsCodeApi();
  document.getElementById('apply')?.addEventListener('click', () => vscodeApi.postMessage({ type: 'apply' }));
  document.getElementById('copy')?.addEventListener('click', () => vscodeApi.postMessage({ type: 'copy' }));
  for (const button of document.querySelectorAll('button[data-line]')) {
    button.addEventListener('click', () => {
      vscodeApi.postMessage({ type: 'goto', line: Number(button.dataset.line) });
    });
  }
</script>
</body>
</html>`;
  }

  dispose(): void {
    ReportPanel.current = undefined;
    this.panel.dispose();
    for (const disposable of this.disposables) disposable.dispose();
  }
}
