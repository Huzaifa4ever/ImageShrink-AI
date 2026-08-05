

import * as vscode from 'vscode';

import { log } from '../logger';
import type { Finding } from '../rules/catalog';
import {
  FIX_AI_REWRITE,
  FIX_CREATE_DOCKERIGNORE,
  FIX_INSERT,
  FIX_REPLACE,
} from '../rules/engine';
import type { AnalysisState } from '../state';
import { toInsertPosition, toRange } from '../util/position';
import { DIAGNOSTIC_SOURCE } from './diagnostics';
import type { FindingDiagnostic } from './diagnostics';

export function editFor(
  document: vscode.TextDocument,
  finding: Finding
): vscode.WorkspaceEdit | undefined {
  if (!finding.replacement) return undefined;

  const edit = new vscode.WorkspaceEdit();

  if (finding.fixKind === FIX_REPLACE) {
    edit.replace(document.uri, toRange(finding.fixRange, document), finding.replacement);
    return edit;
  }

  if (finding.fixKind === FIX_INSERT) {
    edit.insert(document.uri, toInsertPosition(finding.fixRange, document), finding.replacement);
    return edit;
  }

  return undefined;
}

export class ImageShrinkCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
    vscode.CodeActionKind.SourceFixAll.append('imageshrink'),
  ];

  constructor(private readonly state: AnalysisState) {}

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    const ours = context.diagnostics.filter(
      (d): d is FindingDiagnostic => d.source === DIAGNOSTIC_SOURCE
    );

    const actions: vscode.CodeAction[] = [];

    for (const diagnostic of ours) {
      const finding = diagnostic.finding;
      if (!finding) continue;
      actions.push(...this.actionsFor(document, finding, diagnostic));
    }

    const fixable = this.fixableFindings(document);
    if (fixable.length > 1) {
      const fixAll = new vscode.CodeAction(
        `ImageShrink: fix all ${fixable.length} auto-fixable findings`,
        vscode.CodeActionKind.SourceFixAll.append('imageshrink')
      );
      fixAll.edit = this.combinedEdit(document, fixable);
      actions.push(fixAll);
    }


    for (const diagnostic of ours) {
      const finding = diagnostic.finding;
      if (!finding) continue;
      const docs = new vscode.CodeAction(
        `Learn about "${finding.title}"`,
        vscode.CodeActionKind.QuickFix
      );
      docs.command = {
        command: 'vscode.open',
        title: 'Open documentation',
        arguments: [vscode.Uri.parse(finding.docsUrl)],
      };
      docs.diagnostics = [diagnostic];
      actions.push(docs);
    }

    void range;
    return actions;
  }

  private actionsFor(
    document: vscode.TextDocument,
    finding: Finding,
    diagnostic: vscode.Diagnostic
  ): vscode.CodeAction[] {
    const title = finding.quickFixTitle ?? `Fix: ${finding.title}`;

    if (finding.fixKind === FIX_REPLACE || finding.fixKind === FIX_INSERT) {
      const edit = editFor(document, finding);
      if (!edit) return [];

      const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
      action.edit = edit;
      action.diagnostics = [diagnostic];
      action.isPreferred = finding.severity === 'critical' || finding.severity === 'high';
      return [action];
    }

    if (finding.fixKind === FIX_CREATE_DOCKERIGNORE) {
      const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
      action.command = {
        command: 'imageshrink.createDockerignore',
        title,
        arguments: [document.uri, finding.replacement],
      };
      action.diagnostics = [diagnostic];
      action.isPreferred = true;
      return [action];
    }

    if (finding.fixKind === FIX_AI_REWRITE) {
      const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
      action.command = {
        command: 'imageshrink.optimizeDockerfile',
        title,
        arguments: [document.uri],
      };
      action.diagnostics = [diagnostic];
      return [action];
    }

    return [];
  }

  private fixableFindings(document: vscode.TextDocument): Finding[] {
    return this.state
      .findings(document.uri)
      .filter((finding) => finding.fixKind === FIX_REPLACE || finding.fixKind === FIX_INSERT)
      .filter((finding) => finding.replacement !== null);
  }

  private combinedEdit(document: vscode.TextDocument, findings: Finding[]): vscode.WorkspaceEdit {
    const edit = new vscode.WorkspaceEdit();

    const ordered = [...findings].sort(
      (a, b) => b.fixRange.line - a.fixRange.line || b.fixRange.column - a.fixRange.column
    );

    const claimed: vscode.Range[] = [];
    for (const finding of ordered) {
      const range =
        finding.fixKind === FIX_INSERT
          ? new vscode.Range(
              toInsertPosition(finding.fixRange, document),
              toInsertPosition(finding.fixRange, document)
            )
          : toRange(finding.fixRange, document);

      const conflicts = claimed.some(
        (existing) => !range.isEmpty && !existing.isEmpty && Boolean(existing.intersection(range))
      );
      if (conflicts) {
        log.debug(`fix-all: skipping ${finding.ruleId}, overlaps an earlier fix`);
        continue;
      }

      if (finding.fixKind === FIX_INSERT) {
        edit.insert(document.uri, range.start, finding.replacement!);
      } else {
        edit.replace(document.uri, range, finding.replacement!);
      }
      claimed.push(range);
    }

    return edit;
  }
}
