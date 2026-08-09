import * as vscode from 'vscode';

import * as cat from '../rules/catalog';

const FROM_LINE_RE = /^\s*FROM\s+(?:--\S+\s+)*(\S*)$/i;

function compatibilityNote(recommendation: cat.ImageRecommendation): string {
  if (recommendation.compatibility >= 95) return 'drop-in';
  if (recommendation.compatibility >= 80) return `~${recommendation.compatibility}% drop-in`;
  return `~${recommendation.compatibility}% drop-in — check carefully`;
}

function buildItem(
  recommendation: cat.ImageRecommendation,
  familyName: string,
  baseSizeMb: number,
  rank: number,
  range: vscode.Range
): vscode.CompletionItem {
  const item = new vscode.CompletionItem(recommendation.image, vscode.CompletionItemKind.Value);

  const saving = baseSizeMb - recommendation.sizeMb;
  item.detail =
    saving > 0
      ? `~${recommendation.sizeMb} MB · saves ~${saving} MB · ${compatibilityNote(recommendation)}`
      : `~${recommendation.sizeMb} MB · ${compatibilityNote(recommendation)}`;

  const documentation = new vscode.MarkdownString('', true);
  documentation.supportThemeIcons = true;
  if (recommendation.recommended) {
    documentation.appendMarkdown('**$(sparkle) Recommended by ImageShrink**\n\n');
  }
  documentation.appendMarkdown(`**${familyName}** — approximately ${recommendation.sizeMb} MB.\n\n`);
  if (saving > 0) {
    documentation.appendMarkdown(
      `About ${saving} MB smaller than the default \`${familyName.toLowerCase()}\` image (estimate).\n\n`
    );
  }
  if (recommendation.note) documentation.appendMarkdown(`${recommendation.note}\n`);
  item.documentation = documentation;

  item.range = range;
  item.filterText = recommendation.image;

  item.sortText = `${recommendation.recommended ? '0' : '1'}${String(rank).padStart(3, '0')}`;
  if (recommendation.recommended) {
    item.preselect = true;
    item.label = { label: recommendation.image, description: 'ImageShrink' };
  }

  return item;
}

export class BaseImageCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.CompletionItem[] | undefined {
    const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
    const match = FROM_LINE_RE.exec(linePrefix);
    if (!match) return undefined;

    const typed = (match[1] ?? '').toLowerCase();
    const range = new vscode.Range(
      position.translate(0, -(match[1] ?? '').length),
      position
    );

    const items: vscode.CompletionItem[] = [];
    const families = cat.families();

    for (const [key, family] of Object.entries(families)) {
      const familyMatches =
        !typed || key.startsWith(typed) || family.displayName.toLowerCase().startsWith(typed);

      family.recommendations.forEach((recommendation, index) => {
        const imageMatches = recommendation.image.toLowerCase().includes(typed);
        if (!familyMatches && !imageMatches) return;
        items.push(buildItem(recommendation, family.displayName, family.defaultSizeMb, index, range));
      });
    }

    if (!items.length) return undefined;
    return items;
  }
}

export const COMPLETION_TRIGGERS = [':', '/', '-', '.'];
