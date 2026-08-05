

import baseImagesJson from '../generated/base-images.json';
import catalogJson from '../generated/rule-catalog.json';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type Category = 'size' | 'security' | 'performance' | 'maintainability';

export type FixKind = 'replace' | 'insert' | 'createDockerignore' | 'aiRewrite';

export interface Rule {
  id: string;
  title: string;
  severity: Severity;
  category: Category;
  instruction: string;
  problem: string;
  explanation: string;
  sizeImpactMb: number;
  savingsMb: number;
  dynamicImpact?: boolean;
  securityImpact: string | null;
  performanceImpact: string | null;
  docsUrl: string;
  quickFixTitle: string | null;
  autoFixable: boolean;
}

export interface Span {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

export interface Finding {
  ruleId: string;
  title: string;
  severity: Severity;
  category: Category;
  instruction: string;
  problem: string;
  explanation: string;
  securityImpact: string | null;
  performanceImpact: string | null;
  docsUrl: string;
  quickFixTitle: string | null;
  detail: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  replacement: string | null;
  fixKind: FixKind | null;
  fixRange: Span;
  autoFixable: boolean;
  sizeImpactMb: number;
  savingsMb: number;
  compatibility: number | null;
  suggestedImage: string | null;
}

export interface Scores {
  optimizationScore: number;
  securityScore: number;
  performanceScore: number;
  findingCount: number;
  bySeverity: Record<Severity, number>;
  estimatedSavingsMb: number;
}

export interface ImageRecommendation {
  image: string;
  sizeMb: number;
  compatibility: number;
  recommended?: boolean;
  note?: string;
}

export interface ImageFamily {
  displayName: string;
  defaultSizeMb: number;
  recommendations: ImageRecommendation[];
}

interface CatalogFile {
  version: number;
  rules: Rule[];
}

interface BaseImagesFile {
  families: Record<string, ImageFamily>;
  distrolessFinalStages: Record<string, string>;
}

const catalogFile = catalogJson as unknown as CatalogFile;
const baseImagesFile = baseImagesJson as unknown as BaseImagesFile;

const rulesById = new Map<string, Rule>(catalogFile.rules.map((rule) => [rule.id, rule]));

export function rule(ruleId: string): Rule {
  const found = rulesById.get(ruleId);
  if (!found) {
    throw new Error(`Unknown rule id: ${ruleId}`);
  }
  return found;
}

export function allRules(): Rule[] {
  return catalogFile.rules;
}

export function families(): Record<string, ImageFamily> {
  return baseImagesFile.families;
}

export function family(key: string): ImageFamily | undefined {
  return baseImagesFile.families[key];
}

export function distrolessFinalStage(key: string): string | undefined {
  return baseImagesFile.distrolessFinalStages[key];
}

export function bestRecommendation(fam: ImageFamily): ImageRecommendation | undefined {
  return fam.recommendations.find((r) => r.recommended) ?? fam.recommendations[0];
}

export const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export function meetsSeverity(severity: Severity, floor: Severity): boolean {
  return SEVERITY_ORDER[severity] <= SEVERITY_ORDER[floor];
}
