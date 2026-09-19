import type { MouseEvent, ReactNode } from "react";

export interface TransactionLinkage {
  type: "internal" | "reimbursement" | "reimbursed";
  reimbursesAllocations?: Array<{
    transactionId?: string;
    pendingBatchIndex?: number;
    stagedDraftId?: string;
    stagedRowId?: string;
    amount: number;
    amountBase?: number;
    reimbursingFxRate?: number;
    reimbursementBaseAmount?: number;
    targetDescription?: string;
    targetDate?: string;
    targetRemainingReimbursable?: number;
  }>;
  reimbursedByAllocations?: Array<{
    transactionId: string;
    amount: number;
    amountBase?: number;
  }>;
  leftoverAmount?: number;
  leftoverCategoryId?: string | null;
  reimbursementBaseAmount?: number;
  reimbursingFxRate?: number;
  syncToBankLedger?: boolean;
  autoDetected?: boolean; // True if parser detected
  detectionReason?: string; // Why it was detected
}

export interface Transaction {
  date: string;
  description: string;
  label?: string;
  categoryId?: string;
  amountIn?: number;
  amountOut?: number;
  balance?: number;
  accountIdentifier?: string;
  accountNumber?: string; // Account number extracted from statement (for import detection)
  entryTypeOverride?:
    | "spending"
    | "reimbursement"
    | "funding_out"
    | "funding_in";
  linkage?: TransactionLinkage | null;
  suggestedCategoryId?: string;
  suggestedLabel?: string;
  suggestedInternal?: boolean;
  suggestionSource?: "rule" | "history" | "heuristic";
  suggestionConfidence?: number;
  suggestionApplied?: boolean;
  metadata: Record<string, any>;
}

export interface Category {
  id: string;
  name: string;
  color: string;
}

export interface AccountIdentifier {
  id: string;
  accountIdentifier: string;
  color: string;
}

export interface ParseResult {
  success: boolean;
  filename: string;
  parserId: string;
  transactions: Transaction[];
  count: number;
}

export interface DuplicateMatch {
  transaction: {
    id: string;
    date: Date;
    description: string;
    amountIn: number | null;
    amountOut: number | null;
    category?: {
      name: string;
      color: string;
    };
  };
  matchScore: number;
  matchReasons: string[];
}

export interface TransactionTableProps {
  parsedData: ParseResult;
  transactions: Transaction[];
  categories: Category[];
  accountIdentifier: string;
  accountColor?: string;
  accountIdentifiers: AccountIdentifier[];
  isNewAccount?: boolean;
  duplicates?: Map<number, DuplicateMatch[]>;
  selectedIndices?: Set<number>;
  nonDuplicateIndices?: Set<number>;
  rowValidationErrors?: Map<number, string[]>;
  isCheckingDuplicates?: boolean;
  isImporting?: boolean;
  showDuplicatesOnly?: boolean;
  showAccountSelector?: boolean;
  pendingAccountColors?: Map<string, string>;
  onUpdateTransaction: (index: number, field: string, value: any) => void;
  onAccountIdentifierChange: (value: string) => void;
  onAccountColorChange?: (color: string) => void;
  onAddAccountIdentifier?: () => void;
  onTransactionAccountIdentifierChange?: (
    index: number,
    accountIdentifier: string,
  ) => void;
  onImport: () => void;
  onConfirmImport?: () => void;
  onSelectAll?: () => void;
  onDeselectAll?: () => void;
  onSelectVisible?: (indices: number[]) => void;
  onDeselectVisible?: (indices: number[]) => void;
  onToggleSelection?: (
    index: number,
    event?: MouseEvent<HTMLButtonElement>,
  ) => void;
  onAddCategoryClick: () => void;
  onBack?: () => void;
  onLinkageChange?: (index: number, linkage: TransactionLinkage | null) => void;
  onOpenReimbursementSelector?: (index: number) => void;
  onOpenSplitTransaction?: (index: number) => void;
  amountInHeader?: string;
  amountOutHeader?: string;
  deferCellCommit?: boolean;
  lockLinkedReimbursements?: boolean;
  allowReservedCategorySelection?: boolean;
  renderExpandedActions?: (
    index: number,
    transaction: Transaction,
  ) => ReactNode;
  reviewActionLeft?: ReactNode;
  primaryActionLabel?: string;
}
