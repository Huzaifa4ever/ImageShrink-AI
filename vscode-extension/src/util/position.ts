

import * as vscode from 'vscode';

import type { Span } from '../rules/catalog';

export function toRange(span: Span, document?: vscode.TextDocument): vscode.Range {
  const start = new vscode.Position(Math.max(0, span.line - 1), Math.max(0, span.column - 1));
  const end = new vscode.Position(Math.max(0, span.endLine - 1), Math.max(0, span.endColumn - 1));

  const range = new vscode.Range(start, end);
  return document ? document.validateRange(range) : range;
}

export function toInsertPosition(span: Span, document: vscode.TextDocument): vscode.Position {
  const line = Math.max(0, Math.min(span.line - 1, document.lineCount));
  return new vscode.Position(line, 0);
}
