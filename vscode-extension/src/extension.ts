import * as vscode from 'vscode';

import { analyze } from './analysis/analyzer';
import { clearCache, TRIVY_INSTALL_HINT, trivyVersion } from './analysis/trivy';
import { config } from './config';
import { initLogger, log } from './logger';
import { ImageShrinkCodeActionProvider } from './providers/codeActions';
import { BaseImageCompletionProvider, COMPLETION_TRIGGERS } from './providers/completion';
import { DOCKERFILE_SELECTOR, DiagnosticsController, isDockerfile } from './providers/diagnostics';
import { ImageShrinkHoverProvider } from './providers/hover';
import { DOCKERIGNORE_TEMPLATE } from './rules/engine';
import { AnalysisState } from './state';
import { ReportPanel } from './views/reportPanel';
import { OverviewProvider, SecurityProvider, SuggestionsProvider } from './views/sidebar';
import { gather, writeDockerignore } from './workspace/context';

const OPTIMIZED_SCHEME = 'imageshrink-optimized';

function targetDocument(uri?: vscode.Uri): vscode.TextDocument | undefined {
  if (uri) {
    const match = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
    if (match) return match;
  }
  const active = vscode.window.activeTextEditor?.document;
  if (active && isDockerfile(active)) return active;

  const open = vscode.workspace.textDocuments.filter(isDockerfile);
  return open.length === 1 ? open[0] : undefined;
}

export function activate(context: vscode.ExtensionContext): void {
  initLogger();
  const version = (context.extension.packageJSON as { version?: string }).version ?? '0.0.0';
  log.info(`ImageShrink AI ${version} activated`);

  const state = new AnalysisState();
  const diagnostics = new DiagnosticsController(state);

  const overview = new OverviewProvider(state);
  const suggestions = new SuggestionsProvider(state);
  const security = new SecurityProvider(state);

  const optimizedContent = new Map<string, string>();
  const optimizedProvider: vscode.TextDocumentContentProvider = {
    provideTextDocumentContent: (uri) => optimizedContent.get(uri.path) ?? '',
  };

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'imageshrink.showReport';

  const updateStatusBar = (): void => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isDockerfile(editor.document)) {
      statusBar.hide();
      return;
    }
    const scores = state.scores(editor.document.uri);
    const count = state.findings(editor.document.uri).length;
    statusBar.text = `$(package) ImageShrink ${scores.optimizationScore}/100`;
    statusBar.tooltip = count
      ? `${count} suggestion(s). Click for the full report.`
      : 'No findings. Click for the full report.';
    statusBar.show();
  };

  context.subscriptions.push(
    state,
    diagnostics,
    statusBar,
    state.onDidChange(updateStatusBar),
    vscode.window.onDidChangeActiveTextEditor(updateStatusBar),

    vscode.workspace.registerTextDocumentContentProvider(OPTIMIZED_SCHEME, optimizedProvider),

    vscode.window.registerTreeDataProvider('imageshrink.overview', overview),
    vscode.window.registerTreeDataProvider('imageshrink.suggestions', suggestions),
    vscode.window.registerTreeDataProvider('imageshrink.security', security),

    vscode.languages.registerCodeActionsProvider(
      DOCKERFILE_SELECTOR,
      new ImageShrinkCodeActionProvider(state),
      { providedCodeActionKinds: ImageShrinkCodeActionProvider.providedCodeActionKinds }
    ),
    vscode.languages.registerHoverProvider(DOCKERFILE_SELECTOR, new ImageShrinkHoverProvider(state)),
    vscode.languages.registerCompletionItemProvider(
      DOCKERFILE_SELECTOR,
      new BaseImageCompletionProvider(),
      ...COMPLETION_TRIGGERS
    )
  );

  updateStatusBar();

  const runFullAnalysis = async (uri?: vscode.Uri): Promise<void> => {
    const document = targetDocument(uri);
    if (!document) {
      void vscode.window.showInformationMessage('ImageShrink: open a Dockerfile first.');
      return;
    }

    await diagnostics.analyzeNow(document);

    const workspaceContext = await gather(document.uri);

    try {
      const analysis = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'ImageShrink: analyzing…',
          cancellable: true,
        },
        async (progress, token) => {
          const controller = new AbortController();
          token.onCancellationRequested(() => controller.abort());

          progress.report({ message: config.trivyEnabled() ? 'scanning base images' : 'checking rules' });

          return analyze({
            content: document.getText(),
            filename: document.isUntitled
              ? 'Dockerfile'
              : document.uri.path.split('/').pop() || 'Dockerfile',
            dockerfilePath: document.uri.scheme === 'file' ? document.uri.fsPath : undefined,
            options: {
              hasDockerignore: workspaceContext.hasDockerignore,
              dockerignore: workspaceContext.dockerignore,
              bloatCandidates: workspaceContext.bloatCandidates,
            },
            signal: controller.signal,
          });
        }
      );

      state.setAnalysis(document.uri, analysis);
      diagnostics.publish(document, analysis.findings);
      ReportPanel.show(analysis, document.uri);

      if (analysis.scan.status === 'unavailable') {
        log.warn(`security scan unavailable: ${analysis.scan.reason}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('analysis failed', error);
      void vscode.window
        .showErrorMessage(`ImageShrink could not analyze this Dockerfile: ${message}`, 'Show Log')
        .then((choice) => {
          if (choice === 'Show Log') log.show();
        });
    }
  };

  const ensureAnalysis = async (document: vscode.TextDocument) => {
    const existing = state.analysis(document.uri);
    if (existing) return existing;
    await runFullAnalysis(document.uri);
    return state.analysis(document.uri);
  };

  const showDiff = async (uri?: vscode.Uri): Promise<void> => {
    const document = targetDocument(uri);
    if (!document) return;

    const analysis = await ensureAnalysis(document);
    if (!analysis) return;

    const key = document.uri.toString();
    optimizedContent.set(key, analysis.optimized.content);

    const right = vscode.Uri.from({ scheme: OPTIMIZED_SCHEME, path: key });
    await vscode.commands.executeCommand(
      'vscode.diff',
      document.uri,
      right,
      `${analysis.filename} ↔ optimized`,
      { preview: true }
    );
  };

  const applyOptimized = async (uri?: vscode.Uri): Promise<void> => {
    const document = targetDocument(uri);
    if (!document) return;

    const analysis = await ensureAnalysis(document);
    if (!analysis) return;

    if (!analysis.optimized.changes.length) {
      void vscode.window.showInformationMessage(
        'ImageShrink: nothing to apply — this Dockerfile already passes every rule.'
      );
      return;
    }

    const choice = await vscode.window.showWarningMessage(
      `Replace ${analysis.filename} with the optimized version?`,
      {
        modal: true,
        detail:
          `${analysis.optimized.changes.length} change(s) will be applied. ` +
          'You can undo with Ctrl+Z.' +
          (analysis.optimized.needsReview
            ? '\n\nThis rewrite includes a commented multi-stage skeleton for you to complete.'
            : ''),
      },
      'Replace',
      'Show Diff First'
    );
    if (!choice) return;

    if (choice === 'Show Diff First') {
      await showDiff(document.uri);
      return;
    }

    const edit = new vscode.WorkspaceEdit();
    const whole = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length)
    );
    edit.replace(document.uri, whole, analysis.optimized.content);
    await vscode.workspace.applyEdit(edit);

    void vscode.window.showInformationMessage(
      `ImageShrink: applied ${analysis.optimized.changes.length} change(s).`
    );
    await diagnostics.analyzeNow(document);
  };

  const createDockerignore = async (uri?: vscode.Uri, content?: string): Promise<void> => {
    const document = targetDocument(uri);
    if (!document) return;

    const created = await writeDockerignore(document.uri, content ?? DOCKERIGNORE_TEMPLATE);
    if (!created) return;

    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(created));
    await diagnostics.analyzeNow(document);
  };

  const openFinding = async (uri: vscode.Uri, line: number, column: number): Promise<void> => {
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);
    const position = new vscode.Position(Math.max(0, line - 1), Math.max(0, column - 1));
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(
      new vscode.Range(position, position),
      vscode.TextEditorRevealType.InCenterIfOutsideViewport
    );
  };

  const showReport = async (): Promise<void> => {
    const document = targetDocument();
    if (!document) {
      void vscode.window.showInformationMessage('ImageShrink: open a Dockerfile first.');
      return;
    }
    const analysis = await ensureAnalysis(document);
    if (analysis) ReportPanel.show(analysis, document.uri);
  };

  const installTrivy = async (): Promise<void> => {
    const found = await trivyVersion();
    if (found) {
      void vscode.window.showInformationMessage(`ImageShrink: Trivy ${found} is installed and working.`);
      return;
    }

    const choice = await vscode.window.showInformationMessage(
      'Trivy is not installed. It is a single binary that scans your base images for known vulnerabilities. Everything else in ImageShrink works without it.',
      'Installation Guide',
      'Open Settings'
    );
    if (choice === 'Installation Guide') {
      void vscode.env.openExternal(
        vscode.Uri.parse('https://github.com/aquasecurity/trivy#installation')
      );
    }
    if (choice === 'Open Settings') {
      void vscode.commands.executeCommand('workbench.action.openSettings', 'imageshrink.security');
    }
    log.info(TRIVY_INSTALL_HINT);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('imageshrink.analyzeDockerfile', runFullAnalysis),
    vscode.commands.registerCommand('imageshrink.optimizeDockerfile', showDiff),
    vscode.commands.registerCommand('imageshrink.showDiff', showDiff),
    vscode.commands.registerCommand('imageshrink.applyOptimized', applyOptimized),
    vscode.commands.registerCommand('imageshrink.createDockerignore', createDockerignore),
    vscode.commands.registerCommand('imageshrink.openFinding', openFinding),
    vscode.commands.registerCommand('imageshrink.showReport', showReport),
    vscode.commands.registerCommand('imageshrink.installTrivy', installTrivy),
    vscode.commands.registerCommand('imageshrink.showOutput', () => log.show()),
    vscode.commands.registerCommand('imageshrink.refresh', async () => {
      clearCache();
      overview.refresh();
      suggestions.refresh();
      security.refresh();
      const document = targetDocument();
      if (document) await diagnostics.analyzeNow(document);
    }),
    vscode.commands.registerCommand('imageshrink.openSettings', () => {
      void vscode.commands.executeCommand('workbench.action.openSettings', 'imageshrink');
    })
  );
}

export function deactivate(): void {
  log.info('ImageShrink AI deactivated');
}
