
import * as vscode from 'vscode';

import { ApiClient, NetworkDisabled, NotSignedIn } from './api/client';
import { ApiError, NetworkError } from './api/http';
import type { AnalysisResult } from './api/types';
import { SessionStore } from './auth/session';
import { config } from './config';
import { initLogger, log } from './logger';
import { BaseImageCompletionProvider, COMPLETION_TRIGGERS } from './providers/completion';
import { ImageShrinkCodeActionProvider } from './providers/codeActions';
import { DOCKERFILE_SELECTOR, DiagnosticsController, isDockerfile } from './providers/diagnostics';
import { ImageShrinkHoverProvider } from './providers/hover';
import { DOCKERIGNORE_TEMPLATE } from './rules/engine';
import { AnalysisState } from './state';
import { HistoryProvider, OverviewProvider, SuggestionsProvider } from './views/sidebar';
import { ReportPanel } from './views/reportPanel';
import { gather, writeDockerignore } from './workspace/context';

function targetDocument(uri?: vscode.Uri): vscode.TextDocument | undefined {
  if (uri) {
    return vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  }
  const active = vscode.window.activeTextEditor?.document;
  if (active && isDockerfile(active)) return active;

  const open = vscode.workspace.textDocuments.filter(isDockerfile);
  return open.length === 1 ? open[0] : undefined;
}

function reportError(error: unknown, action: string): void {
  if (error instanceof NotSignedIn) {
    void vscode.window.showWarningMessage(error.message, 'Sign In').then((choice) => {
      if (choice === 'Sign In') void vscode.commands.executeCommand('imageshrink.signIn');
    });
    return;
  }

  if (error instanceof NetworkDisabled) {
    void vscode.window.showWarningMessage(error.message, 'Open Settings').then((choice) => {
      if (choice === 'Open Settings') {
        void vscode.commands.executeCommand(
          'workbench.action.openSettings',
          'imageshrink.useLocalRulesOnly'
        );
      }
    });
    return;
  }

  if (error instanceof ApiError && error.isThrottled) {
    void vscode.window.showWarningMessage(
      `ImageShrink: ${error.message}`,
      'Show Log'
    ).then((choice) => {
      if (choice === 'Show Log') log.show();
    });
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  log.error(`${action} failed`, error);
  void vscode.window
    .showErrorMessage(`ImageShrink could not ${action}: ${message}`, 'Show Log')
    .then((choice) => {
      if (choice === 'Show Log') log.show();
    });
}

export function activate(context: vscode.ExtensionContext): void {
  initLogger();
  const version = (context.extension.packageJSON as { version?: string }).version ?? '0.0.0';
  log.info(`ImageShrink AI ${version} activated`);

  const state = new AnalysisState();
  const session = new SessionStore(context);
  const client = new ApiClient(session);
  const diagnostics = new DiagnosticsController(state);

  const overview = new OverviewProvider(state, session);
  const suggestions = new SuggestionsProvider(state);
  const history = new HistoryProvider(client, session);

  const syncSignedInKey = (): void => {
    void vscode.commands.executeCommand(
      'setContext',
      'imageshrink.signedIn',
      session.isSignedIn
    );
  };
  syncSignedInKey();

  context.subscriptions.push(
    state,
    session,
    diagnostics,
    session.onDidChangeSession(syncSignedInKey),

    vscode.window.registerTreeDataProvider('imageshrink.overview', overview),
    vscode.window.registerTreeDataProvider('imageshrink.suggestions', suggestions),
    vscode.window.registerTreeDataProvider('imageshrink.history', history),

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


  const runFullAnalysis = async (uri?: vscode.Uri): Promise<void> => {
    const document = targetDocument(uri);
    if (!document) {
      void vscode.window.showInformationMessage('ImageShrink: open a Dockerfile first.');
      return;
    }

    await diagnostics.analyzeNow(document);

    if (!config.aiAllowed()) {
      void vscode.window.showInformationMessage(
        'ImageShrink: showing built-in rule findings. Enable the AI backend for a full rewrite, size estimate and CVE scan.',
        'Open Settings'
      ).then((choice) => {
        if (choice === 'Open Settings') {
          void vscode.commands.executeCommand('workbench.action.openSettings', 'imageshrink');
        }
      });
      return;
    }

    const workspaceContext = config.sendWorkspaceContext()
      ? await gather(document.uri)
      : { hasDockerignore: undefined, dockerignore: undefined, packageJson: undefined, bloatCandidates: [] };

    try {
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'ImageShrink: analyzing Dockerfile…',
          cancellable: true,
        },
        async (_progress, token) => {
          const controller = new AbortController();
          token.onCancellationRequested(() => controller.abort());

          return client.analyze(
            {
              content: document.getText(),
              filename: document.isUntitled
                ? 'Dockerfile'
                : document.uri.path.split('/').pop() || 'Dockerfile',
              model: config.model() || undefined,
              dockerignore: workspaceContext.dockerignore,
              hasDockerignore: workspaceContext.hasDockerignore,
              packageJson: workspaceContext.packageJson,
              bloatCandidates: workspaceContext.bloatCandidates,
              save: true,
              clientVersion: version,
            },
            controller.signal
          );
        }
      );

      state.setResult(document.uri, result);
      diagnostics.publish(document, result.ruleFindings ?? []);
      history.refresh();
      ReportPanel.show(result, document.uri);

      if (result.scheduling?.fellBack) {
        log.info(
          `requested ${result.modelRequested}, answered by ${result.modelUsed} after fallback`
        );
      }
    } catch (error) {
      if (error instanceof NetworkError && error.message === 'Cancelled.') return;
      reportError(error, 'analyze this Dockerfile');
    }
  };

  const applyOptimized = async (uri?: vscode.Uri): Promise<void> => {
    const document = targetDocument(uri);
    if (!document) return;

    const result = state.result(document.uri);
    if (!result?.optimizedDockerfile) {
      void vscode.window.showInformationMessage(
        'ImageShrink: run "Analyze Dockerfile" first to generate an optimized version.'
      );
      return;
    }

    // Replacing the user's file is destructive and not obviously reversible to someone who
    // does not think in terms of undo, so it is confirmed explicitly.
    const choice = await vscode.window.showWarningMessage(
      `Replace the contents of ${result.filename} with the optimized version?`,
      { modal: true, detail: 'You can undo this with Ctrl+Z. The original stays in your history.' },
      'Replace',
      'Open as New File'
    );
    if (!choice) return;

    if (choice === 'Open as New File') {
      const doc = await vscode.workspace.openTextDocument({
        content: result.optimizedDockerfile,
        language: 'dockerfile',
      });
      await vscode.window.showTextDocument(doc);
      return;
    }

    const edit = new vscode.WorkspaceEdit();
    const wholeFile = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length)
    );
    edit.replace(document.uri, wholeFile, result.optimizedDockerfile);
    await vscode.workspace.applyEdit(edit);
    void vscode.window.showInformationMessage('ImageShrink: applied the optimized Dockerfile.');
  };

  const createDockerignore = async (uri?: vscode.Uri, content?: string): Promise<void> => {
    const document = targetDocument(uri);
    if (!document) return;

    const created = await writeDockerignore(document.uri, content ?? DOCKERIGNORE_TEMPLATE);
    if (!created) return;

    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(created));
    // The finding that prompted this should disappear now, so re-lint.
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

  const openHistoryItem = async (id: string): Promise<void> => {
    try {
      const result: AnalysisResult = await client.analysis(id);
      const document = targetDocument();
      ReportPanel.show(result, document?.uri ?? vscode.Uri.parse('untitled:Dockerfile'));
    } catch (error) {
      reportError(error, 'open that analysis');
    }
  };

  const showReport = (): void => {
    const document = targetDocument();
    const result = document ? state.result(document.uri) : undefined;
    if (!result || !document) {
      void vscode.window.showInformationMessage(
        'ImageShrink: no report yet. Run "Analyze Dockerfile" to generate one.'
      );
      return;
    }
    ReportPanel.show(result, document.uri);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('imageshrink.signIn', async () => {
      await session.signIn();
      history.refresh();
      overview.refresh();
    }),
    vscode.commands.registerCommand('imageshrink.signOut', async () => {
      await session.signOut();
      history.refresh();
      overview.refresh();
    }),
    vscode.commands.registerCommand('imageshrink.analyzeDockerfile', runFullAnalysis),
    vscode.commands.registerCommand('imageshrink.optimizeDockerfile', runFullAnalysis),
    vscode.commands.registerCommand('imageshrink.applyOptimized', applyOptimized),
    vscode.commands.registerCommand('imageshrink.createDockerignore', createDockerignore),
    vscode.commands.registerCommand('imageshrink.openFinding', openFinding),
    vscode.commands.registerCommand('imageshrink.openHistoryItem', openHistoryItem),
    vscode.commands.registerCommand('imageshrink.showReport', showReport),
    vscode.commands.registerCommand('imageshrink.showOutput', () => log.show()),
    vscode.commands.registerCommand('imageshrink.refresh', () => {
      history.refresh();
      overview.refresh();
      suggestions.refresh();
      const document = targetDocument();
      if (document) void diagnostics.analyzeNow(document);
    }),
    vscode.commands.registerCommand('imageshrink.openSettings', () => {
      void vscode.commands.executeCommand('workbench.action.openSettings', 'imageshrink');
    }),
    vscode.commands.registerCommand('imageshrink.openOnWeb', () => {
      void vscode.env.openExternal(vscode.Uri.parse(`${config.webUrl()}/history`));
    })
  );
}

export function deactivate(): void {
  log.info('ImageShrink AI deactivated');
}
