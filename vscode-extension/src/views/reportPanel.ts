import * as vscode from 'vscode';

import type { LocalAnalysis } from '../analysis/types';
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
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i += 1) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}

function formatMb(mb: number | null): string {
  if (mb === null) return 'unknown';
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
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
    private analysis: LocalAnalysis,
    private sourceUri: vscode.Uri
  ) {
    this.panel = vscode.window.createWebviewPanel(
      'imageshrink.report',
      `ImageShrink — ${analysis.filename}`,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true }
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      (message: { type: string; line?: number }) => {
        if (message.type === 'apply') {
          void vscode.commands.executeCommand('imageshrink.applyOptimized', this.sourceUri);
        }
        if (message.type === 'diff') {
          void vscode.commands.executeCommand('imageshrink.showDiff', this.sourceUri);
        }
        if (message.type === 'copy') {
          void vscode.env.clipboard.writeText(this.analysis.optimized.content);
          void vscode.window.showInformationMessage('ImageShrink: optimized Dockerfile copied.');
        }
        if (message.type === 'goto' && typeof message.line === 'number') {
          void vscode.commands.executeCommand('imageshrink.openFinding', this.sourceUri, message.line, 1);
        }
      },
      null,
      this.disposables
    );

    this.render();
  }

  static show(analysis: LocalAnalysis, sourceUri: vscode.Uri): ReportPanel {
    if (ReportPanel.current) {
      ReportPanel.current.analysis = analysis;
      ReportPanel.current.sourceUri = sourceUri;
      ReportPanel.current.panel.title = `ImageShrink — ${analysis.filename}`;
      ReportPanel.current.render();
      ReportPanel.current.panel.reveal(vscode.ViewColumn.Beside, true);
      return ReportPanel.current;
    }

    ReportPanel.current = new ReportPanel(analysis, sourceUri);
    return ReportPanel.current;
  }

  private render(): void {
    this.panel.webview.html = this.html();
  }

  private sizeSection(): string {
    const { size } = this.analysis;

    if (size.totalMb === null) {
      return `<h2>Image size</h2>
        <p class="empty">No size on file for <code>${escapeHtml(size.baseImage ?? 'this base image')}</code>,
        so the total cannot be estimated.</p>`;
    }

    const basis =
      size.baseConfidence === 'measured'
        ? 'Base image measured with the local Docker daemon; layer sizes are estimated.'
        : 'Estimated from typical image sizes — not a measurement of your build.';

    return `
      <h2>Image size</h2>
      <div class="sizes">
        <strong>${escapeHtml(formatMb(size.totalMb))}</strong>
        <span class="arrow">→</span>
        <strong class="good">${escapeHtml(formatMb(size.optimizedMb))}</strong>
        <span class="muted">saves about ${escapeHtml(formatMb(size.savedMb))} (${size.savingsPercent}%)</span>
      </div>
      <table>
        <tbody>
          <tr><td>Base image</td><td><code>${escapeHtml(size.baseImage ?? '—')}</code></td>
              <td class="nowrap">${escapeHtml(formatMb(size.baseMb))}</td></tr>
          <tr><td>Added by RUN and COPY</td><td class="muted">${escapeHtml(size.notes.join('; ') || 'nothing significant')}</td>
              <td class="nowrap">+${escapeHtml(formatMb(size.addedMb))}</td></tr>
        </tbody>
      </table>
      <p class="muted small">${escapeHtml(basis)} Build both images to compare for certain.</p>`;
  }

  private securitySection(): string {
    const { scan } = this.analysis;

    if (scan.status === 'disabled') {
      return '<h2>Security</h2><p class="empty">Scanning is turned off in settings.</p>';
    }
    if (scan.status === 'notRun') {
      return '<h2>Security</h2><p class="empty">Not scanned.</p>';
    }
    if (scan.status === 'unavailable') {
      return `<h2>Security</h2>
        <div class="notice">${escapeHtml(scan.reason)}</div>
        <p class="muted small">Findings above are unaffected — they come from the built-in rules,
        which need no external tools.</p>`;
    }

    const { summary } = scan;
    const chips = `
      <div class="chips">
        <span class="chip bad">${summary.critical} critical</span>
        <span class="chip warn">${summary.high} high</span>
        <span class="chip">${summary.medium} medium</span>
        <span class="chip">${summary.low} low</span>
        ${summary.fixable > 0 ? `<span class="chip good">${summary.fixable} fixable</span>` : ''}
      </div>`;

    const skipped = scan.skippedImages.length
      ? `<p class="muted small">Skipped: ${scan.skippedImages
          .map((s) => `<code>${escapeHtml(s.image)}</code> (${escapeHtml(s.reason)})`)
          .join(', ')}</p>`
      : '';

    if (!scan.vulnerabilities.length) {
      return `<h2>Security</h2>
        <p class="empty">No known vulnerabilities in ${escapeHtml(scan.scannedImages.join(', ') || 'the scanned images')}.</p>
        ${skipped}`;
    }

    const rows = scan.vulnerabilities
      .map(
        (cve) => `<tr>
          <td class="nowrap"><span class="badge sev-${escapeHtml(cve.severity)}">${escapeHtml(cve.severity)}</span></td>
          <td>${cve.referenceUrl ? `<a href="${escapeHtml(cve.referenceUrl)}">${escapeHtml(cve.cveId)}</a>` : escapeHtml(cve.cveId)}
              <div class="muted small">${escapeHtml(cve.title)}</div></td>
          <td>${cve.packages.map((p) => `<code>${escapeHtml(p.name)}</code>`).join(', ')}</td>
          <td class="nowrap">${cve.packages.find((p) => p.fixedVersion)?.fixedVersion
            ? escapeHtml(cve.packages.find((p) => p.fixedVersion)!.fixedVersion!)
            : '<span class="muted">no fix</span>'}</td>
        </tr>`
      )
      .join('');

    return `
      <h2>Security</h2>
      ${chips}
      <p class="muted small">${summary.total} unique CVEs across
        ${escapeHtml(scan.scannedImages.join(', '))}, scanned with Trivy ${escapeHtml(scan.version ?? '')}.
        ${scan.vulnerabilities.length < summary.total ? `Showing the ${scan.vulnerabilities.length} most severe.` : ''}</p>
      <table>
        <thead><tr><th>Severity</th><th>CVE</th><th>Package</th><th>Fixed in</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${skipped}`;
  }

  private misconfigSection(): string {
    const items = this.analysis.scan.misconfigurations;
    if (!items.length) return '';

    return `
      <h2>Dockerfile checks (Trivy)</h2>
      <ul class="findings">
        ${items
          .map(
            (m) => `<li class="finding sev-${escapeHtml(m.severity)}">
              <div class="finding-head">
                <span class="badge">${escapeHtml(m.severity)}</span>
                ${m.line > 0 ? `<button class="linkish" data-line="${m.line}">${escapeHtml(m.title)}</button>` : escapeHtml(m.title)}
                <span class="muted">${escapeHtml(m.checkId)}</span>
              </div>
              <p>${escapeHtml(m.description)}</p>
              ${m.resolution ? `<p class="muted">${escapeHtml(m.resolution)}</p>` : ''}
            </li>`
          )
          .join('')}
      </ul>`;
  }

  private findingsSection(findings: Finding[]): string {
    if (!findings.length) {
      return '<p class="empty">No rule findings — this Dockerfile follows the built-in best practices.</p>';
    }

    return `<ul class="findings">${findings
      .map(
        (finding) => `
        <li class="finding sev-${escapeHtml(finding.severity)}">
          <div class="finding-head">
            <span class="badge">${escapeHtml(finding.severity)}</span>
            <button class="linkish" data-line="${finding.line}">${escapeHtml(finding.title)}</button>
            <span class="muted">line ${finding.line}</span>
            ${finding.savingsMb > 0 ? `<span class="saving">~${escapeHtml(formatMb(finding.savingsMb))}</span>` : ''}
            ${finding.autoFixable ? '<span class="chip good">quick fix</span>' : ''}
          </div>
          <p>${escapeHtml(finding.problem)}</p>
          ${finding.detail ? `<p class="muted">${escapeHtml(finding.detail)}</p>` : ''}
        </li>`
      )
      .join('')}</ul>`;
  }

  private html(): string {
    const n = nonce();
    const csp = `default-src 'none'; style-src 'nonce-${n}'; script-src 'nonce-${n}';`;
    const a = this.analysis;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>ImageShrink report</title>
<style nonce="${n}">
  :root { color-scheme: light dark; }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
         color: var(--vscode-foreground); background: var(--vscode-editor-background);
         padding: 1.25rem 1.5rem 3rem; line-height: 1.55; }
  h1 { font-size: 1.25rem; margin: 0 0 .25rem; }
  h2 { font-size: 1rem; margin: 2rem 0 .6rem; padding-bottom: .3rem;
       border-bottom: 1px solid var(--vscode-panel-border); }
  p { margin: .4rem 0; }
  a { color: var(--vscode-textLink-foreground); }
  code { font-family: var(--vscode-editor-font-family); font-size: .88em; }
  .muted { color: var(--vscode-descriptionForeground); }
  .small { font-size: .82rem; }
  .empty { color: var(--vscode-descriptionForeground); font-style: italic; }
  .nowrap { white-space: nowrap; }

  .scores { display: flex; flex-wrap: wrap; gap: .75rem; margin: 1rem 0; }
  .score { flex: 1 1 8rem; border: 1px solid var(--vscode-panel-border);
           border-radius: 6px; padding: .7rem .8rem; }
  .score .value { font-size: 1.5rem; font-weight: 600; }
  .score .label { font-size: .75rem; text-transform: uppercase; letter-spacing: .06em;
                  color: var(--vscode-descriptionForeground); }
  .good { color: var(--vscode-testing-iconPassed, #4ADE80); }
  .warn { color: var(--vscode-editorWarning-foreground, #FBBF24); }
  .bad  { color: var(--vscode-errorForeground, #FF6B6B); }

  .sizes { display: flex; align-items: baseline; gap: .6rem; font-size: 1.05rem; margin: .6rem 0;
           flex-wrap: wrap; }
  .arrow { color: var(--vscode-descriptionForeground); }

  .actions { display: flex; gap: .5rem; margin: 1rem 0; flex-wrap: wrap; }
  button { font-family: inherit; font-size: .85rem; padding: .45rem .9rem; border-radius: 4px;
           border: 1px solid var(--vscode-button-border, transparent);
           background: var(--vscode-button-background); color: var(--vscode-button-foreground);
           cursor: pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground);
                     color: var(--vscode-button-secondaryForeground); }
  button.linkish { background: none; border: none; padding: 0;
                   color: var(--vscode-textLink-foreground); cursor: pointer; font-size: inherit; }
  button.linkish:hover { text-decoration: underline; background: none; }

  pre { background: var(--vscode-textCodeBlock-background); padding: .8rem; border-radius: 6px;
        overflow-x: auto; max-height: 30rem; }

  table { width: 100%; border-collapse: collapse; font-size: .85rem; display: block;
          overflow-x: auto; }
  th, td { text-align: left; padding: .45rem .6rem;
           border-bottom: 1px solid var(--vscode-panel-border); vertical-align: top; }
  th { color: var(--vscode-descriptionForeground); font-weight: 600; }

  .chips { display: flex; gap: .4rem; flex-wrap: wrap; margin: .5rem 0; }
  .chip { font-size: .75rem; padding: .15rem .5rem; border-radius: 999px;
          border: 1px solid var(--vscode-panel-border); }

  .findings { list-style: none; padding: 0; margin: .5rem 0; }
  .finding { border-left: 3px solid var(--vscode-panel-border); padding: .5rem .8rem;
             margin-bottom: .6rem; }
  .finding.sev-critical { border-left-color: var(--vscode-errorForeground, #FF6B6B); }
  .finding.sev-high { border-left-color: var(--vscode-editorWarning-foreground, #FBBF24); }
  .finding-head { display: flex; align-items: baseline; gap: .5rem; flex-wrap: wrap; }
  .badge { font-size: .68rem; text-transform: uppercase; letter-spacing: .06em;
           padding: .1rem .4rem; border-radius: 3px; border: 1px solid var(--vscode-panel-border); }
  .badge.sev-critical, .badge.sev-high { color: var(--vscode-errorForeground, #FF6B6B); }
  .saving { font-size: .75rem; color: var(--vscode-testing-iconPassed, #4ADE80); }

  .notice { border: 1px solid var(--vscode-editorWarning-foreground, #FBBF24); border-radius: 6px;
            padding: .6rem .8rem; margin: 1rem 0; font-size: .87rem; }
  ul.changes { margin: .4rem 0 1rem; padding-left: 1.2rem; font-size: .85rem; }
</style>
</head>
<body>
  <h1>${escapeHtml(a.filename)}</h1>
  <p class="muted small">Analysed locally · ${escapeHtml(new Date(a.analyzedAt).toLocaleString())}</p>

  <div class="scores">
    <div class="score"><div class="value ${scoreClass(a.scores.optimizationScore)}">${a.scores.optimizationScore}</div><div class="label">Optimization</div></div>
    <div class="score"><div class="value ${scoreClass(a.scores.securityScore)}">${a.scores.securityScore}</div><div class="label">Security</div></div>
    <div class="score"><div class="value ${scoreClass(a.scores.performanceScore)}">${a.scores.performanceScore}</div><div class="label">Performance</div></div>
    <div class="score"><div class="value">${a.findings.length}</div><div class="label">Findings</div></div>
  </div>

  ${this.sizeSection()}

  <h2>Optimized Dockerfile</h2>
  ${
    a.optimized.changes.length
      ? `<ul class="changes">${a.optimized.changes.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul>`
      : '<p class="empty">Nothing to change — every rule already passes.</p>'
  }
  ${
    a.optimized.needsReview
      ? '<div class="notice">This rewrite needs your input: converting to a multi-stage build requires knowing which build outputs to keep, so a commented skeleton is included instead of a guess.</div>'
      : ''
  }
  <div class="actions">
    <button id="apply">Apply to editor</button>
    <button id="diff" class="secondary">Show diff</button>
    <button id="copy" class="secondary">Copy</button>
  </div>
  <pre><code>${escapeHtml(a.optimized.content)}</code></pre>

  <h2>Findings (${a.findings.length})</h2>
  ${this.findingsSection(a.findings)}

  ${this.securitySection()}
  ${this.misconfigSection()}

<script nonce="${n}">
  const api = acquireVsCodeApi();
  document.getElementById('apply')?.addEventListener('click', () => api.postMessage({ type: 'apply' }));
  document.getElementById('diff')?.addEventListener('click', () => api.postMessage({ type: 'diff' }));
  document.getElementById('copy')?.addEventListener('click', () => api.postMessage({ type: 'copy' }));
  for (const button of document.querySelectorAll('button[data-line]')) {
    button.addEventListener('click', () => api.postMessage({ type: 'goto', line: Number(button.dataset.line) }));
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
