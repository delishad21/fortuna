"use client";

import { useRef, useState } from "react";
import type { MouseEvent } from "react";
import { parseFilesWithParsers, type MultiFileParseResult } from "@/app/actions/parser";
import { createCategory } from "@/app/actions/categories";
import { upsertAccountNumber } from "@/app/actions/accountNumbers";
import {
  getPaylahInternalPreferenceState,
  setPaylahInternalPreference,
} from "@/app/actions/importRules";
import {
  checkImportDuplicates,
  commitImport,
  type DuplicateMatch,
} from "@/app/actions/transactions";
import { AddCategoryModal } from "@/components/ui/AddCategoryModal";
import { Modal, type ModalType } from "@/components/ui/Modal";
import { NewAccountColorModal } from "@/components/ui/NewAccountColorModal";
import { AddAccountIdentifierModal } from "@/components/ui/AddAccountIdentifierModal";
import { UploadSection, type FileUploadState } from "./UploadSection";
import { TransactionTable } from "@/components/transaction-table/TransactionTable";
import { ReimbursementSelectorModal } from "./ReimbursementSelectorModal";
import {
  SplitTransactionModal,
  type SplitTransactionChildInput,
} from "@/components/transactions/SplitTransactionModal";
import type { TransactionLinkage } from "@/components/transaction-table/types";
import {
  formatImportValidationErrors,
  validateImportSelection,
  type ImportValidationError,
} from "./importValidation";
import {
  buildSourceAwareTransactions,
  detectNewAccountIdentifiers,
  mergeFileParseStatuses,
} from "./importAccountMapping";

const PRESET_COLORS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#eab308",
  "#84cc16",
  "#22c55e",
  "#10b981",
  "#14b8a6",
  "#06b6d4",
  "#0ea5e9",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#a855f7",
  "#d946ef",
  "#ec4899",
];

const PAYLAH_PARSER_ID = "dbs_paylah_statement";

type ImportStage = "upload" | "review" | "duplicates" | "complete";

interface Transaction {
  date: string;
  description: string;
  label?: string;
  categoryId?: string;
  amountIn?: number;
  amountOut?: number;
  balance?: number;
  currency?: string;
  accountIdentifier?: string;
  accountNumber?: string;
  metadata: Record<string, any>;
  linkage?: TransactionLinkage | null;
  suggestedCategoryId?: string;
  suggestedLabel?: string;
  suggestedInternal?: boolean;
  suggestionSource?: "rule" | "history" | "heuristic";
  suggestionConfidence?: number;
  suggestionApplied?: boolean;
}

interface Category {
  id: string;
  name: string;
  color: string;
}

interface ParserOption {
  value: string;
  label: string;
  description: string;
}

interface AccountIdentifier {
  id: string;
  accountIdentifier: string;
  color: string;
}

interface ImportClientProps {
  initialCategories: Category[];
  initialAccountNumbers: AccountIdentifier[];
  parserOptions: ParserOption[];
}

export function ImportClient({
  initialCategories,
  initialAccountNumbers,
  parserOptions,
}: ImportClientProps) {
  const [stage, setStage] = useState<ImportStage>("upload");

  const [files, setFiles] = useState<FileUploadState[]>([]);
  const [selectedParser, setSelectedParser] = useState<string>(
    parserOptions[0]?.value || "generic_csv",
  );
  const [parseResults, setParseResults] = useState<MultiFileParseResult[]>([]);
  const [editedTransactions, setEditedTransactions] = useState<Transaction[]>(
    [],
  );
  const [accountIdentifier, setAccountIdentifier] = useState<string>("");
  const [accountColor, setAccountColor] = useState<string>("#6366f1");
  const [isNewAccount, setIsNewAccount] = useState(false);
  const [showNewAccountModal, setShowNewAccountModal] = useState(false);
  const [accountIdentifiers, setAccountIdentifiers] = useState<
    AccountIdentifier[]
  >(initialAccountNumbers);
  const [isAddCategoryModalOpen, setIsAddCategoryModalOpen] = useState(false);
  const [categories, setCategories] = useState<Category[]>(initialCategories);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accountMismatchError, setAccountMismatchError] = useState<string | null>(null);
  const [isAddAccountModalOpen, setIsAddAccountModalOpen] = useState(false);
  const [pendingAccountColors, setPendingAccountColors] = useState<Map<string, string>>(
    new Map(),
  );
  const [isPaylahPromptOpen, setIsPaylahPromptOpen] = useState(false);
  const [isPaylahPromptConfirming, setIsPaylahPromptConfirming] =
    useState(false);
  const [pendingUploadAfterPaylahPrompt, setPendingUploadAfterPaylahPrompt] =
    useState(false);
  const paylahPromptConfirmedRef = useRef(false);
  const lastSelectionRef = useRef<{
    index: number;
    checked: boolean;
  } | null>(null);

  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(
    new Set(),
  );
  const [validationErrors, setValidationErrors] = useState<ImportValidationError[]>([]);

  const [duplicates, setDuplicates] = useState<Map<number, DuplicateMatch[]>>(
    new Map(),
  );
  const [nonDuplicateIndices, setNonDuplicateIndices] = useState<Set<number>>(
    new Set(),
  );
  const [isCheckingDuplicates, setIsCheckingDuplicates] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    type: ModalType;
    title: string;
    message: string;
  }>({
    isOpen: false,
    type: "info",
    title: "",
    message: "",
  });

  const [reimbursementModalOpen, setReimbursementModalOpen] = useState(false);
  const [reimbursementTargetIndex, setReimbursementTargetIndex] = useState<
    number | null
  >(null);
  const [splitTargetIndex, setSplitTargetIndex] = useState<number | null>(null);

  const showModal = (type: ModalType, title: string, message: string) => {
    setModalState({ isOpen: true, type, title, message });
  };

  const showValidationErrors = (errors: ImportValidationError[]) => {
    setValidationErrors(errors);
    showModal(
      "error",
      "Resolve Import Errors",
      formatImportValidationErrors(errors),
    );
  };

  const validateSelectionOrShowErrors = (indices: Set<number>) => {
    const result = validateImportSelection(editedTransactions, indices);
    if (!result.valid) {
      showValidationErrors(result.errors);
      return false;
    }
    setValidationErrors([]);
    return true;
  };

  const closeModal = () => {
    setModalState((prev) => ({ ...prev, isOpen: false }));
  };

  const handleFilesChange = (nextFiles: FileUploadState[]) => {
    setFiles(nextFiles);
    setError(null);
    setAccountMismatchError(null);
  };

  const handleLinkageChange = (
    index: number,
    linkage: TransactionLinkage | null,
  ) => {
    if (linkage?.type === "reimbursement") {
      const inflow = editedTransactions[index]?.amountIn ?? 0;
      if (!(inflow > 0)) {
        showModal(
          "warning",
          "Invalid Reimbursement",
          "Only positive inflow transactions can be marked as reimbursement.",
        );
        return;
      }
    }

    const updated = [...editedTransactions];
    updated[index] = { ...updated[index], linkage };

    if (linkage?.type === "internal" || linkage?.type === "reimbursement") {
      const reservedName =
        linkage.type === "internal" ? "Internal" : "Reimbursement";
      const reservedCategory = categories.find(
        (category) => category.name === reservedName,
      );
      updated[index].categoryId = reservedCategory?.id;
    } else if (!linkage) {
      const currentCategory = categories.find(
        (category) => category.id === updated[index].categoryId,
      );
      if (
        currentCategory?.name === "Internal" ||
        currentCategory?.name === "Reimbursement"
      ) {
        updated[index].categoryId = undefined;
      }
    }

    setEditedTransactions(updated);
    setValidationErrors([]);
    lastSelectionRef.current = null;
  };

  const handleOpenReimbursementSelector = (index: number) => {
    const transaction = editedTransactions[index];
    const inflow = transaction?.amountIn ?? 0;
    if (!(inflow > 0)) {
      showModal(
        "warning",
        "Invalid Reimbursement",
        "Only positive inflow transactions can be marked as reimbursement.",
      );
      return;
    }
    setReimbursementTargetIndex(index);
    setReimbursementModalOpen(true);
  };

  const showReimbursementSplitWarning = () => {
    showModal(
      "warning",
      "Cannot Split Reimbursement",
      "Reimbursement transactions cannot be split. To split this transaction, first remove the reimbursements, then redo the reimbursements on the split transactions.",
    );
  };

  const handleOpenSplitTransaction = (index: number) => {
    const linkage = editedTransactions[index]?.linkage;
    if (linkage?.type === "reimbursement" || linkage?.type === "reimbursed") {
      showReimbursementSplitWarning();
      return;
    }
    setSplitTargetIndex(index);
  };

  const shiftIndicesAfterSplit = (indices: Set<number>, splitIndex: number) => {
    const next = new Set<number>();
    indices.forEach((index) => {
      if (index < splitIndex) {
        next.add(index);
      } else if (index === splitIndex) {
        next.add(splitIndex);
        next.add(splitIndex + 1);
      } else {
        next.add(index + 1);
      }
    });
    return next;
  };

  const handleConfirmSplitTransaction = (
    children: [SplitTransactionChildInput, SplitTransactionChildInput],
  ) => {
    if (splitTargetIndex === null) return;
    const original = editedTransactions[splitTargetIndex];
    if (!original) return;

    const splitRows = children.map((child, childIndex) => ({
      ...original,
      description: child.description,
      label: child.label,
      categoryId:
        original.linkage?.type === "internal"
          ? original.categoryId
          : child.categoryId || undefined,
      amountIn: child.amountIn || undefined,
      amountOut: child.amountOut || undefined,
      balance: childIndex === 1 ? original.balance : undefined,
      metadata: {
        ...original.metadata,
        splitFromDescription: original.description,
        splitChildIndex: childIndex + 1,
      },
      linkage:
        original.linkage?.type === "internal"
          ? { ...original.linkage, autoDetected: false }
          : null,
    })) as Transaction[];

    setEditedTransactions((prev) => [
      ...prev.slice(0, splitTargetIndex),
      splitRows[0],
      splitRows[1],
      ...prev.slice(splitTargetIndex + 1),
    ]);
    setSelectedIndices((prev) => shiftIndicesAfterSplit(prev, splitTargetIndex));
    setNonDuplicateIndices((prev) =>
      shiftIndicesAfterSplit(prev, splitTargetIndex),
    );
    setDuplicates(new Map());
    setValidationErrors([]);
    setSplitTargetIndex(null);
  };

  const handleConfirmReimbursement = (linkage: TransactionLinkage) => {
    if (reimbursementTargetIndex !== null) {
      const currentLinkage =
        editedTransactions[reimbursementTargetIndex]?.linkage;
      const inflow =
        editedTransactions[reimbursementTargetIndex]?.amountIn ?? 0;
      if (currentLinkage?.type === "internal") {
        showModal(
          "warning",
          "Invalid Reimbursement",
          "Internal transactions cannot be marked as reimbursements. Clear the internal flag first.",
        );
      } else if (!(inflow > 0)) {
        showModal(
          "warning",
          "Invalid Reimbursement",
          "Only positive inflow transactions can be marked as reimbursement.",
        );
      } else {
        handleLinkageChange(reimbursementTargetIndex, linkage);
      }
    }
    setReimbursementModalOpen(false);
    setReimbursementTargetIndex(null);
  };

  const performUpload = async () => {
    const pendingFiles = files.filter(
      (f) => f.status === "pending" || f.status === "error",
    );
    if (pendingFiles.length === 0) {
      setError("No files to parse");
      return;
    }

    setIsUploading(true);
    setError(null);
    setAccountMismatchError(null);
    setParseResults([]);

    setFiles((prev) =>
      prev.map((f) =>
        f.status === "pending" || f.status === "error"
          ? { ...f, status: "parsing" as const, error: undefined }
          : f,
      ),
    );

    try {
      const results = await parseFilesWithParsers(
        pendingFiles.map((fileState) => ({
          file: fileState.file,
          parserId: fileState.parserId || selectedParser,
        })),
      );

      const updatedFiles = mergeFileParseStatuses(files, pendingFiles, results);
      setFiles(updatedFiles);
      setParseResults(results);

      const successfulResults = results.filter((r) => r.success);
      if (successfulResults.length === 0) {
        setError("All files failed to parse");
        return;
      }

      const initialTransactions = buildSourceAwareTransactions(successfulResults).map((t) => ({
        ...t,
        label: t.label && t.label.trim().length > 0 ? t.label : undefined,
      })) as Transaction[];
      setEditedTransactions(initialTransactions);

      setSelectedIndices(
        new Set(initialTransactions.map((_, index) => index)),
      );

      const newAccounts = detectNewAccountIdentifiers(
        initialTransactions,
        accountIdentifiers,
      );
      if (newAccounts.length > 0) {
        setPendingAccountColors(
          new Map(
            newAccounts.map((newAccount, index) => [
              newAccount,
              PRESET_COLORS[index % PRESET_COLORS.length],
            ]),
          ),
        );
        setShowNewAccountModal(true);
      } else {
        setPendingAccountColors(new Map());
      }

      setStage("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse files");
      setFiles((prev) =>
        prev.map((f) =>
          f.status === "parsing"
            ? { ...f, status: "error" as const, error: "Parse failed" }
            : f,
        ),
      );
    } finally {
      setIsUploading(false);
    }
  };

  const continueAfterPaylahPrompt = async (enabled: boolean) => {
    setIsPaylahPromptConfirming(true);
    try {
      const result = await setPaylahInternalPreference(enabled);
      setIsPaylahPromptOpen(false);
      setPendingUploadAfterPaylahPrompt(false);

      if (enabled && result.updatedCount > 0) {
        showModal(
          "info",
          "PayLah Internal Auto-Marking Enabled",
          `Updated ${result.updatedCount} prior DBS transaction${result.updatedCount === 1 ? "" : "s"} to Internal.`,
        );
      }

      await performUpload();
    } catch (error) {
      setIsPaylahPromptOpen(false);
      setPendingUploadAfterPaylahPrompt(false);
      showModal(
        "error",
        "Unable to Save PayLah Preference",
        error instanceof Error
          ? error.message
          : "Failed to save PayLah preference.",
      );
    } finally {
      paylahPromptConfirmedRef.current = false;
      setIsPaylahPromptConfirming(false);
    }
  };

  const handleUpload = async () => {
    const pendingFiles = files.filter(
      (f) => f.status === "pending" || f.status === "error",
    );
    if (pendingFiles.length === 0) {
      setError("No files to parse");
      return;
    }

    if (pendingFiles.some((fileState) => fileState.parserId === PAYLAH_PARSER_ID)) {
      try {
        const state = await getPaylahInternalPreferenceState();
        if (state.shouldPrompt) {
          setPendingUploadAfterPaylahPrompt(true);
          setIsPaylahPromptOpen(true);
          return;
        }
      } catch (error) {
        showModal(
          "error",
          "Unable to Check PayLah Preference",
          error instanceof Error
            ? error.message
            : "Failed to check PayLah internal preference.",
        );
        return;
      }
    }

    await performUpload();
  };

  const handleUpdateTransaction = (
    index: number,
    field: string,
    value: any,
  ) => {
    setEditedTransactions((prev) => {
      const updated = [...prev];
      const nextRow = { ...updated[index], [field]: value };
      if (field === "label") {
        nextRow.suggestedLabel = undefined;
      }
      if (field === "categoryId") {
        nextRow.suggestedCategoryId = undefined;
      }
      updated[index] = nextRow;
      return updated;
    });
    setValidationErrors([]);
  };

  const handleAddCategory = async (name: string, color: string) => {
    try {
      const newCategory = await createCategory(name, color);
      setCategories([...categories, newCategory]);
    } catch (error) {
      console.error("Failed to create category:", error);
      showModal(
        "error",
        "Failed to Create Category",
        error instanceof Error ? error.message : "Failed to create category",
      );
    }
  };

  const handleImportTransactions = async () => {
    if (parseResults.length === 0 || selectedIndices.size === 0) return;

    const selectedIndexList = Array.from(selectedIndices).sort((a, b) => a - b);
    const normalizedSelection = new Set(selectedIndexList);
    if (!validateSelectionOrShowErrors(normalizedSelection)) return;

    setIsCheckingDuplicates(true);
    setError(null);

    try {
      const selectedTransactions = selectedIndexList
        .map((index) => ({
          ...editedTransactions[index],
          date: new Date(editedTransactions[index].date),
        }));

      const result = await checkImportDuplicates(selectedTransactions);

      if (result.duplicates.length > 0) {
        const duplicateMap = new Map<number, DuplicateMatch[]>();
        result.duplicates.forEach(({ index, matches }) => {
          const originalIndex = selectedIndexList[index];
          duplicateMap.set(originalIndex, matches);
        });
        setDuplicates(duplicateMap);

        const duplicateOriginalIndices = new Set(
          result.duplicates.map(
            ({ index }) => selectedIndexList[index],
          ),
        );
        const nonDups = new Set(
          selectedIndexList.filter(
            (i) => !duplicateOriginalIndices.has(i),
          ),
        );
        setNonDuplicateIndices(nonDups);

        setSelectedIndices(new Set());

        setStage("duplicates");
      } else {
        await performImport(normalizedSelection);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to check duplicates",
      );
    } finally {
      setIsCheckingDuplicates(false);
    }
  };

  const performImport = async (indices: Set<number>) => {
    if (parseResults.length === 0 || indices.size === 0) return;
    if (!validateSelectionOrShowErrors(indices)) return;

    setIsImporting(true);
    setError(null);

    try {
      const uniqueParserIds = new Set(
        parseResults.filter((result) => result.success).map((result) => result.parserId),
      );
      const result = await commitImport(
        editedTransactions.map((t) => ({
          ...t,
          date: new Date(t.date),
          accountIdentifier:
            t.accountIdentifier && t.accountIdentifier.trim().length > 0
              ? t.accountIdentifier.trim()
              : undefined,
          label:
            t.label && t.label.trim().length > 0
              ? t.label.trim()
              : t.description,
        })),
        Array.from(indices),
        {
          filename: parseResults.map((r) => r.filename).join("; "),
          fileType: "multiple",
          parserId:
            uniqueParserIds.size === 1
              ? Array.from(uniqueParserIds)[0]
              : "multiple",
        },
      );

      if (result.success) {
        showModal(
          "success",
          "Import Successful",
          `Successfully imported ${result.importedCount} transaction${result.importedCount !== 1 ? "s" : ""} into your account!`,
        );
        resetImportFlow();
      } else {
        throw new Error(result.error || "Import failed");
      }
    } catch (err) {
      showModal(
        "error",
        "Import Failed",
        err instanceof Error ? err.message : "Failed to import transactions",
      );
    } finally {
      setIsImporting(false);
    }
  };

  const handleSelectAll = () => {
    setSelectedIndices(new Set(editedTransactions.map((_, i) => i)));
    setValidationErrors([]);
    lastSelectionRef.current = null;
  };

  const handleDeselectAll = () => {
    setSelectedIndices(new Set());
    setValidationErrors([]);
    lastSelectionRef.current = null;
  };

  const handleSelectVisible = (indices: number[]) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      indices.forEach((index) => next.add(index));
      setValidationErrors([]);
      return next;
    });
  };

  const handleDeselectVisible = (indices: number[]) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      indices.forEach((index) => next.delete(index));
      const validationSelection =
        stage === "duplicates"
          ? new Set([...next, ...nonDuplicateIndices])
          : next;
      const result = validateImportSelection(editedTransactions, validationSelection);
      if (!result.valid) {
        showValidationErrors(result.errors);
        return prev;
      }
      setValidationErrors([]);
      return next;
    });
  };

  const handleToggleSelection = (
    index: number,
    event?: MouseEvent<HTMLButtonElement>,
  ) => {
    const currentChecked = selectedIndices.has(index);
    const nextChecked = !currentChecked;
    const newSelection = new Set(selectedIndices);

    if (event?.shiftKey && lastSelectionRef.current) {
      const start = Math.min(lastSelectionRef.current.index, index);
      const end = Math.max(lastSelectionRef.current.index, index);
      for (let rangeIndex = start; rangeIndex <= end; rangeIndex++) {
        if (lastSelectionRef.current.checked) {
          newSelection.add(rangeIndex);
        } else {
          newSelection.delete(rangeIndex);
        }
      }
    } else if (nextChecked) {
      newSelection.add(index);
    } else {
      newSelection.delete(index);
    }

    const validationSelection =
      stage === "duplicates"
        ? new Set([...newSelection, ...nonDuplicateIndices])
        : newSelection;
    const result = validateImportSelection(editedTransactions, validationSelection);
    if (!result.valid) {
      showValidationErrors(result.errors);
      return;
    }
    setValidationErrors([]);
    setSelectedIndices(newSelection);
    lastSelectionRef.current = {
      index,
      checked: event?.shiftKey && lastSelectionRef.current
        ? lastSelectionRef.current.checked
        : nextChecked,
    };
  };

  const handleConfirmImport = async () => {
    const allIndicesToImport = new Set([
      ...selectedIndices,
      ...nonDuplicateIndices,
    ]);
    if (!validateSelectionOrShowErrors(allIndicesToImport)) return;
    await performImport(allIndicesToImport);
  };

  const handleBackFromReview = () => {
    setStage("upload");
  };

  const resetImportFlow = () => {
    setStage("upload");
    setParseResults([]);
    setEditedTransactions([]);
    setFiles([]);
    setDuplicates(new Map());
    setSelectedIndices(new Set());
    setNonDuplicateIndices(new Set());
    setAccountIdentifier("");
    setAccountColor("#6366f1");
    setIsNewAccount(false);
    setShowNewAccountModal(false);
    setPendingAccountColors(new Map());
    setAccountMismatchError(null);
    setValidationErrors([]);
    lastSelectionRef.current = null;
  };

  const handleBackFromDuplicates = () => {
    setStage("review");
    const allOriginalIndices = new Set([
      ...selectedIndices,
      ...nonDuplicateIndices,
      ...Array.from(duplicates.keys()),
    ]);
    setSelectedIndices(allOriginalIndices);
    setDuplicates(new Map());
    setNonDuplicateIndices(new Set());
  };

  const handleSaveAccountIdentifier = async (
    identifier: string,
    color: string,
  ) => {
    try {
      const saved = await upsertAccountNumber(identifier, color);
      setAccountIdentifiers((prev) => {
        const exists = prev.some(
          (acc) => acc.accountIdentifier === saved.accountIdentifier,
        );
        return exists
          ? prev.map((acc) =>
              acc.accountIdentifier === saved.accountIdentifier ? saved : acc,
            )
          : [...prev, saved];
      });
      setAccountIdentifier(saved.accountIdentifier);
      setAccountColor(saved.color);
      setIsNewAccount(false);
    } catch (err) {
      showModal(
        "error",
        "Failed to Save Account",
        err instanceof Error ? err.message : "Failed to save account",
      );
    }
  };

  const handleConfirmAccountColors = async (
    colorsByAccount: Record<string, string>,
  ) => {
    const accountsToSave = Array.from(pendingAccountColors.keys());
    try {
      const savedAccounts = await Promise.all(
        accountsToSave.map((accountIdentifier) =>
          upsertAccountNumber(
            accountIdentifier,
            colorsByAccount[accountIdentifier] ||
              pendingAccountColors.get(accountIdentifier) ||
              PRESET_COLORS[0],
          ),
        ),
      );

      setAccountIdentifiers((prev) => {
        const byIdentifier = new Map(
          prev.map((account) => [account.accountIdentifier, account]),
        );
        savedAccounts.forEach((account) => {
          byIdentifier.set(account.accountIdentifier, account);
        });
        return Array.from(byIdentifier.values());
      });
      setPendingAccountColors(new Map());
      setShowNewAccountModal(false);
    } catch (err) {
      showModal(
        "error",
        "Failed to Save Accounts",
        err instanceof Error ? err.message : "Failed to save accounts",
      );
    }
  };

  const handleAddAccountIdentifier = () => {
    setIsAddAccountModalOpen(true);
  };

  const handleTransactionAccountIdentifierChange = (
    index: number,
    nextAccountIdentifier: string,
  ) => {
    const updated = [...editedTransactions];
    updated[index] = {
      ...updated[index],
      accountIdentifier: nextAccountIdentifier || undefined,
      metadata: {
        ...(updated[index].metadata || {}),
        ...(nextAccountIdentifier
          ? { accountIdentifier: nextAccountIdentifier }
          : { accountIdentifier: undefined }),
      },
    };
    setEditedTransactions(updated);
  };

  const uniqueParsedParserIds = new Set(
    parseResults.filter((result) => result.success).map((result) => result.parserId),
  );
  const aggregatedParsedData = parseResults.length > 0
    ? {
        success: true,
        filename: parseResults.map((r) => r.filename).join("; "),
        parserId:
          uniqueParsedParserIds.size === 1
            ? Array.from(uniqueParsedParserIds)[0]
            : "multiple",
        transactions: editedTransactions,
        count: editedTransactions.length,
      }
    : null;
  const rowValidationErrors = new Map<number, string[]>();
  validationErrors.forEach((validationError) => {
    validationError.indices.forEach((index) => {
      rowValidationErrors.set(index, [
        ...(rowValidationErrors.get(index) || []),
        validationError.message,
      ]);
    });
  });

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {stage === "upload" && (
        <div className="flex-1 p-8 overflow-hidden">
          <UploadSection
            files={files}
            selectedParser={selectedParser}
            parserOptions={parserOptions}
            isUploading={isUploading}
            error={error}
            accountMismatchError={accountMismatchError}
            onFilesChange={handleFilesChange}
            onParserChange={setSelectedParser}
            onUpload={handleUpload}
          />
        </div>
      )}

      {(stage === "review" || stage === "duplicates") && aggregatedParsedData && (
        <TransactionTable
          parsedData={aggregatedParsedData}
          transactions={editedTransactions}
          categories={categories}
          accountIdentifier={accountIdentifier}
          accountColor={accountColor}
          accountIdentifiers={accountIdentifiers}
          isNewAccount={isNewAccount}
          duplicates={stage === "duplicates" ? duplicates : undefined}
          selectedIndices={selectedIndices}
          nonDuplicateIndices={nonDuplicateIndices}
          rowValidationErrors={rowValidationErrors}
          isCheckingDuplicates={isCheckingDuplicates}
          isImporting={isImporting}
          showDuplicatesOnly={stage === "duplicates"}
          showAccountSelector={false}
          pendingAccountColors={pendingAccountColors}
          onUpdateTransaction={handleUpdateTransaction}
          onAccountIdentifierChange={setAccountIdentifier}
          onAccountColorChange={setAccountColor}
          onAddAccountIdentifier={handleAddAccountIdentifier}
          onTransactionAccountIdentifierChange={
            handleTransactionAccountIdentifierChange
          }
          onImport={handleImportTransactions}
          onConfirmImport={handleConfirmImport}
          onSelectAll={handleSelectAll}
          onDeselectAll={handleDeselectAll}
          onSelectVisible={handleSelectVisible}
          onDeselectVisible={handleDeselectVisible}
          onToggleSelection={handleToggleSelection}
          onAddCategoryClick={() => setIsAddCategoryModalOpen(true)}
          onBack={
            stage === "review" ? handleBackFromReview : handleBackFromDuplicates
          }
          onLinkageChange={stage === "review" ? handleLinkageChange : undefined}
          onOpenReimbursementSelector={
            stage === "review" ? handleOpenReimbursementSelector : undefined
          }
          onOpenSplitTransaction={
            stage === "review" ? handleOpenSplitTransaction : undefined
          }
          deferCellCommit
          lockLinkedReimbursements={false}
          allowReservedCategorySelection={stage === "review"}
        />
      )}

      <AddCategoryModal
        isOpen={isAddCategoryModalOpen}
        onClose={() => setIsAddCategoryModalOpen(false)}
        onAdd={handleAddCategory}
      />

      <NewAccountColorModal
        isOpen={showNewAccountModal}
        accounts={Array.from(pendingAccountColors.entries()).map(
          ([accountIdentifier, defaultColor]) => ({
            accountIdentifier,
            defaultColor,
          }),
        )}
        onConfirm={handleConfirmAccountColors}
        onCancel={resetImportFlow}
      />

      <AddAccountIdentifierModal
        isOpen={isAddAccountModalOpen}
        onCancel={() => setIsAddAccountModalOpen(false)}
        onConfirm={async (identifier, color) => {
          await handleSaveAccountIdentifier(identifier, color);
          setIsAddAccountModalOpen(false);
        }}
      />

      <Modal
        isOpen={modalState.isOpen}
        onClose={closeModal}
        type={modalState.type}
        title={modalState.title}
        message={modalState.message}
      />

      <Modal
        isOpen={isPaylahPromptOpen}
        onClose={() => {
          if (paylahPromptConfirmedRef.current) {
            return;
          }
          if (!pendingUploadAfterPaylahPrompt || isPaylahPromptConfirming) {
            setIsPaylahPromptOpen(false);
            return;
          }
          void continueAfterPaylahPrompt(false);
        }}
        type="info"
        title="Auto-Mark PayLah Transactions as Internal?"
        message={
          "Enable this to auto-mark PayLah transfer rows as Internal in future imports.\n\nIf enabled, prior imported DBS statements will also be updated to mark PayLah rows as Internal."
        }
        confirmText={
          isPaylahPromptConfirming ? "Saving..." : "Enable and Continue"
        }
        cancelText="Skip and Continue"
        onConfirm={() => {
          paylahPromptConfirmedRef.current = true;
          void continueAfterPaylahPrompt(true);
        }}
      />

      {splitTargetIndex !== null && editedTransactions[splitTargetIndex] && (
        <SplitTransactionModal
          isOpen={splitTargetIndex !== null}
          transaction={editedTransactions[splitTargetIndex]}
          categories={categories}
          onClose={() => setSplitTargetIndex(null)}
          onConfirm={handleConfirmSplitTransaction}
        />
      )}

      <ReimbursementSelectorModal
        isOpen={reimbursementModalOpen}
        onClose={() => {
          setReimbursementModalOpen(false);
          setReimbursementTargetIndex(null);
        }}
        onConfirm={handleConfirmReimbursement}
        currentIndex={reimbursementTargetIndex ?? 0}
        transactions={editedTransactions}
        currentLinkage={
          reimbursementTargetIndex !== null
            ? editedTransactions[reimbursementTargetIndex]?.linkage
            : null
        }
        categories={categories}
      />
    </div>
  );
}
