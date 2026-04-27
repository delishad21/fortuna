export type SuggestionSource = "history" | "heuristic" | "rule" | "learned_pattern";

export interface ParsedImportTransaction {
  date: string;
  description: string;
  label?: string;
  categoryId?: string;
  amountIn?: number;
  amountOut?: number;
  metadata?: Record<string, any>;
  linkage?: {
    type: "internal" | "reimbursement" | "reimbursed";
    autoDetected?: boolean;
    detectionReason?: string;
  } | null;
  suggestedCategoryId?: string;
  suggestedLabel?: string;
  suggestedInternal?: boolean;
  suggestionSource?: SuggestionSource;
  suggestionConfidence?: number;
  suggestionApplied?: boolean;
}

export interface AutoLabelSettings {
  enabled: boolean;
  threshold: number;
}

export interface AutoSuggestion {
  categoryId?: string;
  label?: string;
  markInternal?: boolean;
  source: SuggestionSource;
  confidence: number;
  reason: string;
  patternId?: string;
  patternType?: string;
  patternValue?: string;
  supportCount?: number;
  autoApply?: boolean;
}

export interface AutoCategorizationContext {
  userId: string;
  parserId: string;
  transactions: ParsedImportTransaction[];
  categoryByName: Map<string, string>;
}

export interface AutoCategorizationStrategy {
  readonly id: string;
  suggest(
    context: AutoCategorizationContext,
  ): Promise<Array<AutoSuggestion | null>>;
}
