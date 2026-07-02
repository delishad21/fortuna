"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { parseFile } from "@/app/actions/parser";
import { createCategory, type Category } from "@/app/actions/categories";
import {
  importTripSpendings,
  type Trip,
  type TripFunding,
  type Wallet,
} from "@/app/actions/trips";
import { useHeaderConfig } from "@/components/Layouts/header-context";
import { FileUploadDropzone } from "@/components/import/FileUploadDropzone";
import { FilePreview } from "@/components/import/FilePreview";
import { TransactionTable } from "@/components/transaction-table/TransactionTable";
import type {
  ParseResult as ImportParseResult,
  Transaction as ImportTransaction,
  TransactionLinkage,
} from "@/components/transaction-table/types";
import { TripReimbursementSelectorModal } from "@/components/trips/TripReimbursementSelectorModal";
import { buildTripImportPayload } from "@/components/trips/tripImportPayload";
import { AddCategoryModal } from "@/components/ui/AddCategoryModal";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Modal } from "@/components/ui/Modal";
import { NumberInput } from "@/components/ui/NumberInput";
import { Select } from "@/components/ui/Select";
import { getCurrencyOptions } from "@/lib/currencies";
import {
  ArrowDownToLine,
  ArrowRightLeft,
  ArrowUpFromLine,
  FileText,
  Link2,
  Pencil,
  Receipt,
  Upload,
  X,
} from "lucide-react";
import type { ParserOption } from "@/lib/parsers";

type FundingOutDestinationType = "bank" | "trip" | "external";
type FundingOutInputMode = "amount" | "fxRate";

interface FundingOutDraft {
  destinationType: FundingOutDestinationType;
  destinationTripId: string;
  destinationCurrency: string;
  destinationAmount: string;
  fxRate: string;
  feeAmount: string;
  feeCurrency: string;
  inputMode: FundingOutInputMode;
}

type ConversionDecisionMode =
  | "unreviewed"
  | "internal"
  | "funding_out"
  | "skip_duplicate"
  | "link_existing";

interface ConversionPairCandidate {
  id: string;
  sourceType: string;
  sourceCurrency: string;
  sourceAmount: number;
  destinationCurrency: string;
  destinationAmount: number;
  dateLabel: string;
  description: string;
  score: number;
}

interface TripImportReviewClientProps {
  trip: Trip;
  wallets: Wallet[];
  categories: Category[];
  tripParserOptions: ParserOption[];
  allTrips: Trip[];
  fundings: TripFunding[];
}

export function TripImportReviewClient({
  trip,
  wallets,
  categories,
  tripParserOptions,
  allTrips,
  fundings,
}: TripImportReviewClientProps) {
  const router = useRouter();
  const { setHeaderConfig } = useHeaderConfig();

  const [localCategories, setLocalCategories] = useState(categories);
  const [isBusy, setIsBusy] = useState(false);
  const [isAddCategoryModalOpen, setIsAddCategoryModalOpen] = useState(false);
  const [mainFiles, setMainFiles] = useState<File[]>([]);
  const [supplementalFile, setSupplementalFile] = useState<File | null>(null);
  const [tripImportStep, setTripImportStep] = useState<"setup" | "review">(
    "setup",
  );
  const [tripImportParsedData, setTripImportParsedData] =
    useState<ImportParseResult | null>(null);
  const [tripImportEditedTransactions, setTripImportEditedTransactions] =
    useState<ImportTransaction[]>([]);
  const [tripImportSelectedIndices, setTripImportSelectedIndices] = useState<
    Set<number>
  >(new Set());
  const [parseErrors, setParseErrors] = useState<Map<string, string>>(new Map());
  const [importForm, setImportForm] = useState({
    parserId: tripParserOptions[0]?.id || "",
    walletId: "",
  });
  const [activeFundingOutIndex, setActiveFundingOutIndex] = useState<
    number | null
  >(null);
  const [conversionReviewOpen, setConversionReviewOpen] = useState(false);
  const [reimbursementModalOpen, setReimbursementModalOpen] = useState(false);
  const [reimbursementTargetIndex, setReimbursementTargetIndex] = useState<
    number | null
  >(null);
  const [fundingOutDraft, setFundingOutDraft] = useState<FundingOutDraft>({
    destinationType: "external",
    destinationTripId: "",
    destinationCurrency: trip.baseCurrency,
    destinationAmount: "",
    fxRate: "",
    feeAmount: "",
    feeCurrency: trip.baseCurrency,
    inputMode: "amount",
  });
  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    type: "success" | "error" | "warning" | "info";
    title: string;
    message: string;
  }>({
    isOpen: false,
    type: "info",
    title: "",
    message: "",
  });
  const currencyOptions = useMemo(() => getCurrencyOptions(), []);
  const isRevolutParser = importForm.parserId === "revolut_statement";
  const isStatementWalletRouted =
    importForm.parserId === "revolut_statement" ||
    importForm.parserId === "youtrip_statement";

  useEffect(() => {
    setHeaderConfig({
      title: `${trip.name} · Import Review`,
      showBack: true,
      backHref: `/trips/${trip.id}/manage`,
    });
    return () => setHeaderConfig(null);
  }, [setHeaderConfig, trip.id, trip.name]);

  const showModal = (
    type: "success" | "error" | "warning" | "info",
    title: string,
    message: string,
  ) => {
    setModalState({
      isOpen: true,
      type,
      title,
      message,
    });
  };

  const closeModal = () =>
    setModalState((prev) => ({
      ...prev,
      isOpen: false,
    }));

  const buildFundingOutDraft = (currency: string): FundingOutDraft => ({
    destinationType: "external",
    destinationTripId: "",
    destinationCurrency: currency || trip.baseCurrency,
    destinationAmount: "",
    fxRate: "",
    feeAmount: "",
    feeCurrency: currency || trip.baseCurrency,
    inputMode: "amount",
  });

  const readFundingOutDraft = (
    transaction: ImportTransaction,
  ): FundingOutDraft | null => {
    const metadata =
      transaction.metadata && typeof transaction.metadata === "object"
        ? (transaction.metadata as Record<string, unknown>)
        : null;
    const raw =
      metadata?.fundingOutConfig &&
      typeof metadata.fundingOutConfig === "object"
        ? (metadata.fundingOutConfig as Record<string, unknown>)
        : null;
    if (!raw) return null;
    const inputMode: FundingOutInputMode =
      String(raw.inputMode || "").toLowerCase() === "fxrate"
        ? "fxRate"
        : "amount";
    return {
      destinationType:
        raw.destinationType === "bank" ||
        raw.destinationType === "trip" ||
        raw.destinationType === "external"
          ? (raw.destinationType as FundingOutDestinationType)
          : "external",
      destinationTripId: String(raw.destinationTripId || ""),
      destinationCurrency: String(
        raw.destinationCurrency || trip.baseCurrency,
      ).toUpperCase(),
      destinationAmount: String(raw.destinationAmount || ""),
      fxRate: String(raw.fxRate || ""),
      feeAmount: String(raw.feeAmount || ""),
      feeCurrency: String(raw.feeCurrency || trip.baseCurrency).toUpperCase(),
      inputMode,
    };
  };

  const validateFundingOutDraft = (draft: FundingOutDraft): string | null => {
    if (!draft.destinationCurrency) {
      return "Destination currency is required.";
    }
    if (draft.destinationType === "trip" && !draft.destinationTripId) {
      return "Select a destination trip.";
    }
    if (
      draft.inputMode === "amount" &&
      !(Number(draft.destinationAmount || 0) > 0)
    ) {
      return "Destination amount must be greater than 0.";
    }
    if (draft.inputMode === "fxRate" && !(Number(draft.fxRate || 0) > 0)) {
      return "FX rate must be greater than 0.";
    }
    if (draft.feeAmount && Number(draft.feeAmount) < 0) {
      return "Fee amount cannot be negative.";
    }
    return null;
  };

  const isAutoFundingInTransaction = (transaction: ImportTransaction) => {
    const transactionType = String(
      (transaction.metadata as Record<string, unknown> | null)?.transactionType ||
        "",
    )
      .trim()
      .toLowerCase();
    if (transaction.entryTypeOverride === "funding_in") return true;
    const metadata =
      transaction.metadata && typeof transaction.metadata === "object"
        ? (transaction.metadata as Record<string, unknown>)
        : {};
    if (metadata.fundingInDisabled === true) return false;
    return transactionType === "topup";
  };

  const getImportTransactionCurrency = (transaction: ImportTransaction) => {
    const metadata =
      transaction.metadata && typeof transaction.metadata === "object"
        ? (transaction.metadata as Record<string, unknown>)
        : null;
    const raw = String(
      metadata?.currency || metadata?.statementCurrency || trip.baseCurrency,
    )
      .trim()
      .toUpperCase();
    return raw || trip.baseCurrency;
  };

  const updateTransactionMetadata = (
    index: number,
    mutate: (metadata: Record<string, unknown>) => void,
  ) => {
    setTripImportEditedTransactions((prev) => {
      const next = [...prev];
      const current = next[index];
      const metadata =
        current.metadata && typeof current.metadata === "object"
          ? { ...(current.metadata as Record<string, unknown>) }
          : {};
      mutate(metadata);
      next[index] = {
        ...current,
        metadata,
      };
      return next;
    });
  };

  const readValuationMode = (transaction: ImportTransaction) => {
    const metadata =
      transaction.metadata && typeof transaction.metadata === "object"
        ? (transaction.metadata as Record<string, unknown>)
        : {};
    const mode = String(metadata.baseValuationMode || "").toLowerCase();
    if (mode === "manual_fx" || mode === "manual_base") return mode;
    return "auto";
  };

  const getLocalAmountForValuation = (transaction: ImportTransaction) => {
    const out = Number(transaction.amountOut || 0);
    const input = Number(transaction.amountIn || 0);
    return out > 0 ? out : input > 0 ? input : 0;
  };

  const getTransactionType = (transaction: ImportTransaction) =>
    String(
      (transaction.metadata as Record<string, unknown> | null)?.transactionType || "",
    )
      .trim()
      .toLowerCase();

  const isConversionTransaction = (transaction: ImportTransaction) =>
    getTransactionType(transaction) === "conversion";

  const toFiniteNumber = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const readConversionReview = (transaction: ImportTransaction) => {
    const metadata =
      transaction.metadata && typeof transaction.metadata === "object"
        ? (transaction.metadata as Record<string, unknown>)
        : null;
    const raw =
      metadata?.conversionReview &&
      typeof metadata.conversionReview === "object"
        ? (metadata.conversionReview as Record<string, unknown>)
        : null;
    const modeRaw = String(raw?.mode || "").toLowerCase();
    const mode: ConversionDecisionMode =
      modeRaw === "internal" ||
      modeRaw === "funding_out" ||
      modeRaw === "skip_duplicate" ||
      modeRaw === "link_existing"
        ? (modeRaw as ConversionDecisionMode)
        : "unreviewed";

    return {
      mode,
      linkedFundingId: raw?.linkedFundingId ? String(raw.linkedFundingId) : "",
    };
  };

  const isConversionDecisionResolved = (transaction: ImportTransaction) => {
    if (!isConversionTransaction(transaction)) return true;
    if (transaction.entryTypeOverride === "funding_out") return true;
    const review = readConversionReview(transaction);
    if (review.mode === "internal" || review.mode === "skip_duplicate") return true;
    if (review.mode === "link_existing" && review.linkedFundingId) return true;
    return false;
  };

  const updateConversionDecision = (
    index: number,
    mode: ConversionDecisionMode,
    linkedFundingId?: string,
  ) => {
    setTripImportEditedTransactions((prev) => {
      const next = [...prev];
      const current = next[index];
      const metadata =
        current.metadata && typeof current.metadata === "object"
          ? { ...(current.metadata as Record<string, unknown>) }
          : {};

      if (mode === "unreviewed") {
        delete metadata.conversionReview;
      } else {
        metadata.conversionReview = {
          mode,
          linkedFundingId:
            mode === "link_existing" ? linkedFundingId || null : null,
        };
      }

      if (mode !== "funding_out" && current.entryTypeOverride === "funding_out") {
        delete metadata.fundingOutConfig;
        next[index] = {
          ...current,
          entryTypeOverride: undefined,
          metadata,
        };
        return next;
      }

      next[index] = {
        ...current,
        metadata,
      };
      return next;
    });
  };

  const conversionPairCandidatesByIndex = useMemo(() => {
    if (!conversionReviewOpen) {
      return new Map<number, ConversionPairCandidate[]>();
    }

    const pairs = new Map<number, ConversionPairCandidate[]>();
    const existingConversions = fundings
      .filter((item) => item.sourceType === "wallet_conversion")
      .map((item) => {
        const metadata =
          item.metadata && typeof item.metadata === "object"
            ? (item.metadata as Record<string, unknown>)
            : {};
        const rawDateSource = metadata.originalDate ?? item.createdAt ?? "";
        const rawDate =
          typeof rawDateSource === "string" || typeof rawDateSource === "number"
            ? String(rawDateSource)
            : "";
        const date = rawDate ? new Date(rawDate) : null;
        const rawDescription =
          metadata.originalDescription ?? metadata.description ?? "Imported conversion";
        const description = String(rawDescription || "Imported conversion");
        const provider =
          String(metadata.provider || metadata.parserId || "").toLowerCase();
        return {
          id: item.id,
          sourceType: item.sourceType,
          sourceCurrency: String(item.sourceCurrency || "").toUpperCase(),
          sourceAmount: Number(item.sourceAmount || 0),
          destinationCurrency: String(item.destinationCurrency || "").toUpperCase(),
          destinationAmount: Number(item.destinationAmount || 0),
          date,
          dateLabel: rawDate,
          description,
          provider,
        };
      })
      .filter(
        (item) =>
          item.sourceCurrency &&
          item.destinationCurrency &&
          item.sourceAmount > 0 &&
          item.destinationAmount > 0,
      );

    tripImportEditedTransactions.forEach((transaction, index) => {
      if (!isConversionTransaction(transaction)) return;
      const metadata =
        transaction.metadata && typeof transaction.metadata === "object"
          ? (transaction.metadata as Record<string, unknown>)
          : {};
      const fromCurrency = String(metadata.fromCurrency || "").toUpperCase();
      const toCurrency = String(metadata.toCurrency || "").toUpperCase();
      const fromAmount = Number(toFiniteNumber(metadata.fromAmount) || 0);
      const toAmount = Number(toFiniteNumber(metadata.toAmount) || 0);
      if (!fromCurrency || !toCurrency || !(fromAmount > 0) || !(toAmount > 0)) {
        pairs.set(index, []);
        return;
      }

      const provider = String(metadata.provider || metadata.parserId || "").toLowerCase();
      const txDate = transaction.date ? new Date(transaction.date) : null;
      const suggestions = existingConversions
        .map((candidate) => {
          const sourceDelta = Math.abs(candidate.sourceAmount - fromAmount);
          const destinationDelta = Math.abs(
            candidate.destinationAmount - toAmount,
          );
          const reverseSourceDelta = Math.abs(candidate.sourceAmount - toAmount);
          const reverseDestinationDelta = Math.abs(
            candidate.destinationAmount - fromAmount,
          );
          const sameDirectionMatch =
            candidate.sourceCurrency === fromCurrency &&
            candidate.destinationCurrency === toCurrency &&
            sourceDelta <= 0.05 &&
            destinationDelta <= 0.05;
          const reverseDirectionMatch =
            candidate.sourceCurrency === toCurrency &&
            candidate.destinationCurrency === fromCurrency &&
            reverseSourceDelta <= 0.05 &&
            reverseDestinationDelta <= 0.05;
          if (!sameDirectionMatch && !reverseDirectionMatch) return null;

          let score = reverseDirectionMatch ? 85 : 75;
          if (provider && candidate.provider && provider === candidate.provider) {
            score += 10;
          }
          if (txDate && candidate.date) {
            const dayDiff = Math.abs(
              txDate.getTime() - candidate.date.getTime(),
            ) /
              (1000 * 60 * 60 * 24);
            if (dayDiff <= 1) score += 10;
            else if (dayDiff <= 3) score += 4;
            else score -= 6;
          }

          return {
            id: candidate.id,
            sourceType: candidate.sourceType,
            sourceCurrency: candidate.sourceCurrency,
            sourceAmount: candidate.sourceAmount,
            destinationCurrency: candidate.destinationCurrency,
            destinationAmount: candidate.destinationAmount,
            dateLabel: candidate.dateLabel,
            description: candidate.description,
            score,
          } satisfies ConversionPairCandidate;
        })
        .filter((item): item is ConversionPairCandidate => Boolean(item))
        .sort((a, b) => b.score - a.score)
        .slice(0, 6);

      pairs.set(index, suggestions);
    });

    return pairs;
  }, [conversionReviewOpen, fundings, tripImportEditedTransactions]);

  const inBatchPairHintsByIndex = useMemo(() => {
    if (!conversionReviewOpen) {
      return new Map<number, number[]>();
    }

    const map = new Map<number, number[]>();
    const conversionRows = tripImportEditedTransactions
      .map((transaction, index) => ({ transaction, index }))
      .filter(({ transaction }) => isConversionTransaction(transaction))
      .map(({ transaction, index }) => {
        const metadata =
          transaction.metadata && typeof transaction.metadata === "object"
            ? (transaction.metadata as Record<string, unknown>)
            : {};
        return {
          index,
          fromCurrency: String(metadata.fromCurrency || "").toUpperCase(),
          toCurrency: String(metadata.toCurrency || "").toUpperCase(),
          fromAmount: Number(toFiniteNumber(metadata.fromAmount) || 0),
          toAmount: Number(toFiniteNumber(metadata.toAmount) || 0),
        };
      })
      .filter(
        (item) =>
          item.fromCurrency &&
          item.toCurrency &&
          item.fromAmount > 0 &&
          item.toAmount > 0,
      );

    conversionRows.forEach((row) => {
      map.set(row.index, []);
    });

    for (let i = 0; i < conversionRows.length; i += 1) {
      for (let j = i + 1; j < conversionRows.length; j += 1) {
        const left = conversionRows[i];
        const right = conversionRows[j];
        const sameDirectionMatch =
          left.fromCurrency === right.fromCurrency &&
          left.toCurrency === right.toCurrency &&
          Math.abs(left.fromAmount - right.fromAmount) <= 0.05 &&
          Math.abs(left.toAmount - right.toAmount) <= 0.05;
        const reverseDirectionMatch =
          left.fromCurrency === right.toCurrency &&
          left.toCurrency === right.fromCurrency &&
          Math.abs(left.fromAmount - right.toAmount) <= 0.05 &&
          Math.abs(left.toAmount - right.fromAmount) <= 0.05;
        if (!sameDirectionMatch && !reverseDirectionMatch) continue;
        map.set(left.index, [...(map.get(left.index) || []), right.index]);
        map.set(right.index, [...(map.get(right.index) || []), left.index]);
      }
    }

    return map;
  }, [conversionReviewOpen, tripImportEditedTransactions]);

  const unresolvedConversionIndices = useMemo(
    () =>
      Array.from(tripImportSelectedIndices)
        .sort((a, b) => a - b)
        .filter((index) => {
          const transaction = tripImportEditedTransactions[index];
          return transaction && isConversionTransaction(transaction);
        })
        .filter((index) => {
          const transaction = tripImportEditedTransactions[index];
          return transaction && !isConversionDecisionResolved(transaction);
        }),
    [tripImportEditedTransactions, tripImportSelectedIndices],
  );

  const selectedConversionRows = useMemo(
    () => {
      if (!conversionReviewOpen) return [];
      return Array.from(tripImportSelectedIndices)
        .sort((a, b) => a - b)
        .map((index) => ({
          index,
          transaction: tripImportEditedTransactions[index],
        }))
        .filter(
          (item): item is { index: number; transaction: ImportTransaction } =>
            Boolean(item.transaction) && isConversionTransaction(item.transaction),
        )
        .map((item) => ({
          ...item,
          review: readConversionReview(item.transaction),
          candidates: conversionPairCandidatesByIndex.get(item.index) || [],
          inBatchHints: inBatchPairHintsByIndex.get(item.index) || [],
        }));
    },
    [
      conversionReviewOpen,
      conversionPairCandidatesByIndex,
      inBatchPairHintsByIndex,
      tripImportEditedTransactions,
      tripImportSelectedIndices,
    ],
  );

  const tableCurrencyIndicator = useMemo(() => {
    let primaryCurrency = "";
    tripImportEditedTransactions.forEach((transaction) => {
      const metadata =
        transaction.metadata && typeof transaction.metadata === "object"
          ? (transaction.metadata as Record<string, unknown>)
          : null;
      const raw = String(
        metadata?.currency || metadata?.statementCurrency || "",
      )
        .trim()
        .toUpperCase();
      if (!primaryCurrency && raw) {
        primaryCurrency = raw;
      }
    });
    return primaryCurrency || trip.baseCurrency;
  }, [trip.baseCurrency, tripImportEditedTransactions]);

  const formatConversionAmount = (amount: unknown, currency: unknown) => {
    const numeric = Number(amount || 0);
    const code = String(currency || "").toUpperCase();
    if (!(numeric > 0) || !code) return "-";
    return `${numeric.toFixed(2)} ${code}`;
  };

  const openFundingOutModal = (index: number) => {
    const transaction = tripImportEditedTransactions[index];
    const existing = readFundingOutDraft(transaction);
    const selectedWalletCurrency =
      wallets.find((wallet) => wallet.id === importForm.walletId)?.currency ||
      trip.baseCurrency;
    setFundingOutDraft(existing || buildFundingOutDraft(selectedWalletCurrency));
    setActiveFundingOutIndex(index);
  };

  const closeFundingOutModal = () => {
    setActiveFundingOutIndex(null);
  };

  const applyConversionDecision = (
    index: number,
    mode: ConversionDecisionMode,
    linkedFundingId?: string,
  ) => {
    if (mode === "funding_out") {
      openFundingOutModal(index);
      return;
    }
    if (mode === "link_existing" && !linkedFundingId) {
      showModal(
        "warning",
        "Match Required",
        "Pick an existing conversion to link for this row.",
      );
      return;
    }
    updateConversionDecision(index, mode, linkedFundingId);
  };

  const handleSaveFundingOutDraft = () => {
    if (activeFundingOutIndex === null) return;
    const error = validateFundingOutDraft(fundingOutDraft);
    if (error) {
      showModal("warning", "Funding Out Details Missing", error);
      return;
    }

    setTripImportEditedTransactions((prev) => {
      const next = [...prev];
      const current = next[activeFundingOutIndex];
      const metadata =
        current.metadata && typeof current.metadata === "object"
          ? { ...(current.metadata as Record<string, unknown>) }
          : {};
      delete metadata.linkage;
      metadata.fundingInDisabled = true;
      if (isConversionTransaction(current)) {
        metadata.conversionReview = {
          mode: "funding_out",
          linkedFundingId: null,
        };
      }
      next[activeFundingOutIndex] = {
        ...current,
        entryTypeOverride: "funding_out",
        linkage: null,
        metadata: {
          ...metadata,
          fundingOutConfig: {
            destinationType: fundingOutDraft.destinationType,
            destinationTripId: fundingOutDraft.destinationTripId || null,
            destinationCurrency: fundingOutDraft.destinationCurrency,
            destinationAmount: fundingOutDraft.destinationAmount,
            fxRate: fundingOutDraft.fxRate,
            feeAmount: fundingOutDraft.feeAmount,
            feeCurrency: fundingOutDraft.feeCurrency,
            inputMode: fundingOutDraft.inputMode,
          },
        },
      };
      return next;
    });

    closeFundingOutModal();
  };

  const handleToggleFundingOutOverride = (index: number) => {
    const transaction = tripImportEditedTransactions[index];
    if (isAutoFundingInTransaction(transaction)) {
      showModal(
        "warning",
        "Funding In Locked",
        "Funding In rows cannot be marked as Funding Out.",
      );
      return;
    }
    if (!(Number(transaction.amountOut || 0) > 0)) {
      showModal(
        "warning",
        "Invalid Funding Out",
        "Only negative (outflow) transactions can be marked as Funding Out.",
      );
      return;
    }
    if (transaction.entryTypeOverride === "funding_out") {
      setTripImportEditedTransactions((prev) => {
        const next = [...prev];
        const current = next[index];
        const metadata =
          current.metadata && typeof current.metadata === "object"
            ? { ...(current.metadata as Record<string, unknown>) }
            : {};
        delete metadata.fundingOutConfig;
        if (isConversionTransaction(current)) {
          metadata.conversionReview = {
            mode: "unreviewed",
            linkedFundingId: null,
          };
        }
        next[index] = {
          ...current,
          entryTypeOverride: undefined,
          linkage: current.linkage,
          metadata,
        };
        return next;
      });
      return;
    }

    openFundingOutModal(index);
  };

  const openReimbursementSelector = (index: number) => {
    const transaction = tripImportEditedTransactions[index];
    if (isAutoFundingInTransaction(transaction)) {
      showModal(
        "warning",
        "Funding In Locked",
        "Funding In rows cannot be marked as reimbursement.",
      );
      return;
    }
    const inflow = Number(transaction?.amountIn || 0);
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

  const toggleFundingInOverride = (index: number) => {
    setTripImportEditedTransactions((prev) => {
      const next = [...prev];
      const current = next[index];
      const metadata =
        current.metadata && typeof current.metadata === "object"
          ? { ...(current.metadata as Record<string, unknown>) }
          : {};
      const currentlyFundingIn = isAutoFundingInTransaction(current);
      if (currentlyFundingIn) {
        metadata.fundingInDisabled = true;
        delete metadata.linkage;
        delete metadata.fundingOutConfig;
        next[index] = {
          ...current,
          entryTypeOverride: undefined,
          linkage: null,
          metadata,
        };
        return next;
      }

      delete metadata.fundingInDisabled;
      delete metadata.linkage;
      delete metadata.fundingOutConfig;
      next[index] = {
        ...current,
        entryTypeOverride: "funding_in",
        linkage: null,
        metadata,
      };
      return next;
    });
  };

  const handleConfirmReimbursement = (linkage: TransactionLinkage) => {
    if (reimbursementTargetIndex === null) return;
    setTripImportEditedTransactions((prev) => {
      const next = [...prev];
      const current = next[reimbursementTargetIndex];
      const metadata =
        current.metadata && typeof current.metadata === "object"
          ? { ...(current.metadata as Record<string, unknown>) }
          : {};
      delete metadata.fundingOutConfig;
      metadata.fundingInDisabled = true;
      metadata.linkage = linkage as unknown as Record<string, unknown>;
      next[reimbursementTargetIndex] = {
        ...current,
        entryTypeOverride: "reimbursement",
        linkage,
        metadata,
      };
      return next;
    });
    setReimbursementModalOpen(false);
    setReimbursementTargetIndex(null);
  };

  const handleTripImportLinkageChange = (
    index: number,
    linkage: TransactionLinkage | null,
  ) => {
    const current = tripImportEditedTransactions[index];
    if (!current) return;

    if (linkage?.type === "reimbursement") {
      openReimbursementSelector(index);
      return;
    }

    if (linkage?.type === "internal") {
      if (isAutoFundingInTransaction(current)) {
        showModal(
          "warning",
          "Funding In Locked",
          "Funding In rows cannot be marked as internal.",
        );
        return;
      }

      setTripImportEditedTransactions((prev) => {
        const next = [...prev];
        const row = next[index];
        const metadata =
          row.metadata && typeof row.metadata === "object"
            ? { ...(row.metadata as Record<string, unknown>) }
            : {};
        delete metadata.fundingOutConfig;
        metadata.fundingInDisabled = true;
        metadata.linkage = linkage as unknown as Record<string, unknown>;
        next[index] = {
          ...row,
          entryTypeOverride:
            row.entryTypeOverride === "reimbursement"
              ? undefined
              : row.entryTypeOverride,
          linkage,
          metadata,
        };
        return next;
      });
      return;
    }

    clearReimbursementOverride(index);
  };

  const clearReimbursementOverride = (index: number) => {
    setTripImportEditedTransactions((prev) => {
      const next = [...prev];
      const current = next[index];
      const metadata =
        current.metadata && typeof current.metadata === "object"
          ? { ...(current.metadata as Record<string, unknown>) }
          : {};
      delete metadata.linkage;
      next[index] = {
        ...current,
        entryTypeOverride:
          current.entryTypeOverride === "reimbursement"
            ? undefined
            : current.entryTypeOverride,
        linkage: null,
        metadata,
      };
      return next;
    });
  };

  const handleAddTripCategory = async (name: string, color: string) => {
    try {
      const nextCategory = await createCategory(name, color);
      setLocalCategories((prev) => [...prev, nextCategory]);
      showModal("success", "Category Added", "Trip category created.");
    } catch (error) {
      showModal(
        "error",
        "Failed to Add Category",
        error instanceof Error ? error.message : "Could not add category.",
      );
    }
  };

  const handleStartTripImportReview = async () => {
    if (mainFiles.length === 0 || !importForm.parserId) return;
    setIsBusy(true);
    setParseErrors(new Map());
    try {
      let parsedResults: ImportParseResult[] = [];

      if (mainFiles.length === 1 && isRevolutParser && supplementalFile) {
        const formData = new FormData();
        formData.append("file", mainFiles[0]);
        formData.append("parserId", importForm.parserId);
        formData.append("supplementalFile", supplementalFile);
        const parsed = (await parseFile(formData)) as ImportParseResult;
        parsedResults = [parsed];
      } else {
        const { parseMultipleFiles } = await import("@/app/actions/parser");
        const results = await parseMultipleFiles(mainFiles, importForm.parserId);

        const errors = new Map<string, string>();
        results.forEach((result) => {
          if (!result.success && result.error) {
            errors.set(result.filename, result.error);
          }
        });

        if (errors.size > 0) {
          setParseErrors(errors);
        }

        parsedResults = results
          .filter((r) => r.success)
          .map((r) => ({
            success: true,
            filename: r.filename,
            parserId: r.parserId,
            transactions: r.transactions,
            count: r.count,
          }));
      }

      if (parsedResults.length === 0) {
        showModal(
          "error",
          "Parse Failed",
          "All files failed to parse. Please check the file formats.",
        );
        return;
      }

      const allTransactions: ImportTransaction[] = [];
      parsedResults.forEach((parsed) => {
        const normalized = (parsed.transactions || []).map((tx) => {
          const metadata =
            tx.metadata && typeof tx.metadata === "object"
              ? { ...(tx.metadata as Record<string, unknown>) }
              : {};
          const transactionType = String(metadata.transactionType || "").toLowerCase();
          const amountIn = Number(tx.amountIn ?? 0) || 0;
          const amountOut = Number(tx.amountOut ?? 0) || 0;
          const netTopupAmount =
            amountIn > 0 ? Math.max(0, amountIn - amountOut) : 0;
          const topupCurrency = String(
            metadata.currency || trip.baseCurrency,
          ).toUpperCase();
          const defaultTopupLabel =
            transactionType === "topup" && netTopupAmount > 0
              ? `Top up of (${topupCurrency}) ${netTopupAmount.toFixed(2)}`
              : undefined;
          const fundingInDisabled = metadata.fundingInDisabled === true;
          const normalizedTx: ImportTransaction = {
            ...tx,
            label:
              tx.label && tx.label.trim().length > 0
                ? tx.label
                : defaultTopupLabel,
            entryTypeOverride:
              tx.entryTypeOverride ||
              (transactionType === "topup" && !fundingInDisabled
                ? "funding_in"
                : undefined),
            metadata,
          };
          if (
            getTransactionType(normalizedTx) === "conversion" &&
            tx.entryTypeOverride !== "funding_out"
          ) {
            const existingConversionReview =
              metadata.conversionReview &&
              typeof metadata.conversionReview === "object"
                ? (metadata.conversionReview as Record<string, unknown>)
                : null;
            if (!existingConversionReview) {
              metadata.conversionReview = {
                mode: "unreviewed",
                linkedFundingId: null,
              };
            }
          }
          return normalizedTx;
        });
        allTransactions.push(...normalized);
      });

      allTransactions.sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
      );

      const aggregatedParsed: ImportParseResult = {
        success: true,
        filename: parsedResults.map((p) => p.filename).join("; "),
        parserId: importForm.parserId,
        transactions: allTransactions,
        count: allTransactions.length,
      };

      setTripImportParsedData(aggregatedParsed);
      setTripImportEditedTransactions(allTransactions);
      setTripImportSelectedIndices(new Set(allTransactions.map((_, index) => index)));
      setConversionReviewOpen(
        allTransactions.some(
          (transaction) =>
            isConversionTransaction(transaction) &&
            !isConversionDecisionResolved(transaction),
        ),
      );
      setTripImportStep("review");
    } catch (error) {
      showModal(
        "error",
        "Parse Failed",
        error instanceof Error ? error.message : "Failed to parse statement.",
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handleTripImportUpdateTransaction = (
    index: number,
    field: string,
    value: unknown,
  ) => {
    setTripImportEditedTransactions((prev) => {
      const next = [...prev];
      const nextRow = { ...next[index], [field]: value };
      if (field === "label") {
        nextRow.suggestedLabel = undefined;
      }
      if (field === "categoryId") {
        nextRow.suggestedCategoryId = undefined;
      }
      next[index] = nextRow;
      return next;
    });
  };

  const handleTripImportSelectAll = () => {
    setTripImportSelectedIndices(
      new Set(tripImportEditedTransactions.map((_, index) => index)),
    );
  };

  const handleTripImportDeselectAll = () => {
    setTripImportSelectedIndices(new Set());
  };

  const handleTripImportSelectVisible = (indices: number[]) => {
    setTripImportSelectedIndices((prev) => {
      const next = new Set(prev);
      indices.forEach((index) => next.add(index));
      return next;
    });
  };

  const handleTripImportDeselectVisible = (indices: number[]) => {
    setTripImportSelectedIndices((prev) => {
      const next = new Set(prev);
      indices.forEach((index) => next.delete(index));
      return next;
    });
  };

  const handleTripImportToggleSelection = (index: number) => {
    setTripImportSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleCommitTripImportReview = async () => {
    if (
      typeof document !== "undefined" &&
      document.activeElement instanceof HTMLElement
    ) {
      document.activeElement.blur();
    }

    if (tripImportSelectedIndices.size === 0) {
      showModal(
        "warning",
        "No Transactions Selected",
        "Select at least one row to import.",
      );
      return;
    }

    if (unresolvedConversionIndices.length > 0) {
      setConversionReviewOpen(true);
      showModal(
        "info",
        "Review Conversions",
        `Please review ${unresolvedConversionIndices.length} conversion row(s) before importing.`,
      );
      return;
    }

    setIsBusy(true);
    try {
      const selectedTransactions = Array.from(tripImportSelectedIndices)
        .sort((a, b) => a - b)
        .map((index) => ({
          index,
          transaction: tripImportEditedTransactions[index],
        }));

      const invalidFundingOutRows = selectedTransactions.filter(
        ({ transaction }) => {
          if (transaction.entryTypeOverride !== "funding_out") return false;
          const draft = readFundingOutDraft(transaction);
          if (!draft) return true;
          return !!validateFundingOutDraft(draft);
        },
      );

      if (invalidFundingOutRows.length > 0) {
        showModal(
          "warning",
          "Funding Out Details Missing",
          `Please complete funding out details for ${invalidFundingOutRows.length} selected transaction(s) before importing.`,
        );
        return;
      }

      const invalidReimbursementRows = selectedTransactions.filter(
        ({ transaction }) => {
          if (transaction.entryTypeOverride !== "reimbursement") return false;
          if (
            !transaction.linkage ||
            transaction.linkage.type !== "reimbursement" ||
            (transaction.linkage.reimbursesAllocations || []).length === 0
          ) {
            return true;
          }
          const currency = getImportTransactionCurrency(transaction);
          const requiresValuation =
            currency.toUpperCase() !== trip.baseCurrency.toUpperCase();
          if (!requiresValuation) return false;
          const base = Number(transaction.linkage.reimbursementBaseAmount || 0);
          const fx = Number(transaction.linkage.reimbursingFxRate || 0);
          return !(base > 0 || fx > 0);
        },
      );

      if (invalidReimbursementRows.length > 0) {
        showModal(
          "warning",
          "Reimbursement Details Missing",
          `Please link reimbursed transactions for ${invalidReimbursementRows.length} reimbursement row(s) before importing.`,
        );
        return;
      }

      await importTripSpendings(
        trip.id,
        {
          walletId: isStatementWalletRouted ? null : importForm.walletId || null,
          parserId: importForm.parserId,
        },
        selectedTransactions.map(({ transaction }) =>
          buildTripImportPayload(transaction, {
            fundingOutDraft: readFundingOutDraft(transaction),
          }),
        ),
      );

      router.push(`/trips/${trip.id}/funding/review`);
    } catch (error) {
      showModal(
        "error",
        "Import Failed",
        error instanceof Error ? error.message : "Failed to import statement.",
      );
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="h-full min-h-0">
      {tripImportStep === "setup" && (
        <div className="h-[calc(100vh-12rem)] min-h-[640px] flex gap-6">
          <div className="w-96 flex flex-col">
            <div className="flex items-center gap-2 mb-4">
              <Upload className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-dark dark:text-white uppercase tracking-wide">
                Import Trip Statement
              </h3>
            </div>

            <div className="flex-1 bg-white dark:bg-dark-2 rounded-lg border border-stroke dark:border-dark-3 p-6 flex flex-col">
              <div className="rounded-lg border border-stroke dark:border-dark-3 bg-gray-1/40 dark:bg-dark-3/40 px-3 py-2 text-xs text-dark-5 dark:text-dark-6">
                Wallets are auto-created by provider and currency (for example
                <span className="font-medium text-dark dark:text-white"> Revolut USD</span>,
                <span className="font-medium text-dark dark:text-white"> YouTrip JPY</span>)
                based on the imported statement transactions.
              </div>

              <div className="mt-4 flex-1 flex flex-col gap-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Parser
                  </label>
                  <Select
                    value={importForm.parserId}
                    onChange={(value) => {
                      setImportForm((prev) => ({ ...prev, parserId: value }));
                      if (value !== "revolut_statement") {
                        setSupplementalFile(null);
                      }
                    }}
                    className="w-full"
                    buttonClassName="w-full"
                    options={tripParserOptions.map((parser) => ({
                      value: parser.id,
                      label: parser.name,
                    }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Target wallet
                  </label>
                  <Select
                    value={importForm.walletId}
                    onChange={(value) =>
                      setImportForm((prev) => ({ ...prev, walletId: value }))
                    }
                    className="w-full"
                    buttonClassName="w-full"
                    disabled={isStatementWalletRouted}
                    options={[
                      {
                        value: "",
                        label: isStatementWalletRouted
                          ? "Auto-routed by provider + currency"
                          : "Auto-create / auto-detect",
                      },
                      ...wallets.map((wallet) => ({
                        value: wallet.id,
                        label: `${wallet.name} (${wallet.currency})`,
                      })),
                    ]}
                  />
                </div>

                <div
                  className={`flex-1 min-h-0 grid gap-4 ${
                    isRevolutParser ? "grid-rows-2" : "grid-rows-1"
                  }`}
                >
                  <div className="min-h-0 min-w-0 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                        Statement file{mainFiles.length > 1 ? `s (${mainFiles.length})` : ""}
                      </label>
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                        Required
                      </span>
                    </div>
                    <div className="h-20 min-h-[80px]">
                      <FileUploadDropzone
                        onFilesAdd={(files) => setMainFiles([...mainFiles, ...files])}
                        accept=".pdf,.csv"
                        compact
                      />
                    </div>
                    {mainFiles.length > 0 && (
                      <div className="flex flex-col gap-1 max-h-28 overflow-y-auto">
                        {mainFiles.map((f, idx) => (
                          <div
                            key={`${f.name}-${idx}`}
                            className="flex items-center gap-2 text-xs"
                          >
                            <FileText className="h-3 w-3 text-primary flex-shrink-0" />
                            <span className="flex-1 truncate text-dark dark:text-white">
                              {f.name}
                            </span>
                            <span className="text-dark-5 dark:text-dark-6">
                              ({(f.size / 1024).toFixed(1)} KB)
                            </span>
                            <button
                              onClick={() =>
                                setMainFiles(mainFiles.filter((_, i) => i !== idx))
                              }
                              className="text-red hover:text-red/80 flex-shrink-0"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                        {parseErrors.size > 0 && (
                          <div className="mt-1 text-xs text-red">
                            {parseErrors.size} file(s) failed to parse
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {isRevolutParser && (
                    <div className="min-h-0 min-w-0 flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                          Revolut CSV merge file
                        </label>
                        <span className="rounded-full bg-dark-4/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                          Optional
                        </span>
                      </div>
                      <div className="flex-1 min-h-0 min-w-0">
                        <FileUploadDropzone
                          onFilesAdd={(files) => { if (files[0]) setSupplementalFile(files[0]); }}
                          accept=".csv"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-4 flex items-center justify-end gap-3">
                <Button
                  variant="secondary"
                  onClick={() => router.push(`/trips/${trip.id}/manage`)}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={handleStartTripImportReview}
                  disabled={isBusy || mainFiles.length === 0 || !importForm.parserId}
                >
                  {isBusy ? "Parsing..." : "Review Import"}
                </Button>
              </div>
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <FilePreview file={mainFiles[0] || null} />
          </div>
        </div>
      )}

      {tripImportStep === "review" && tripImportParsedData && (
        <div className="h-[calc(100vh-12rem)] min-h-[640px] flex min-h-0 flex-col gap-4 overflow-hidden">
          <div className="min-h-0 flex-1 overflow-hidden">
            <TransactionTable
              parsedData={tripImportParsedData}
              transactions={tripImportEditedTransactions}
              categories={localCategories}
              accountIdentifier=""
              accountIdentifiers={[]}
              showAccountSelector={false}
              selectedIndices={tripImportSelectedIndices}
              isCheckingDuplicates={false}
              isImporting={isBusy}
              showDuplicatesOnly={false}
              onUpdateTransaction={handleTripImportUpdateTransaction}
              onAccountIdentifierChange={() => {}}
              onImport={handleCommitTripImportReview}
              onSelectAll={handleTripImportSelectAll}
              onDeselectAll={handleTripImportDeselectAll}
              onSelectVisible={handleTripImportSelectVisible}
              onDeselectVisible={handleTripImportDeselectVisible}
              onToggleSelection={handleTripImportToggleSelection}
              onAddCategoryClick={() => setIsAddCategoryModalOpen(true)}
              onBack={() => setTripImportStep("setup")}
              onLinkageChange={handleTripImportLinkageChange}
              onOpenReimbursementSelector={openReimbursementSelector}
              amountInHeader={`In (${tableCurrencyIndicator})`}
              amountOutHeader={`Out (${tableCurrencyIndicator})`}
              deferCellCommit
              lockLinkedReimbursements={false}
              allowReservedCategorySelection
              renderExpandedActions={(index, transaction) => {
                const isFundingOut =
                  transaction.entryTypeOverride === "funding_out";
                const isFundingIn = isAutoFundingInTransaction(transaction);
                const isConversion = isConversionTransaction(transaction);
                const conversionReview = readConversionReview(transaction);
                const conversionCandidates =
                  conversionPairCandidatesByIndex.get(index) || [];
                const isConversionResolved = isConversionDecisionResolved(transaction);
                const fundingOutConfig = readFundingOutDraft(transaction);
                const metadata =
                  transaction.metadata && typeof transaction.metadata === "object"
                    ? (transaction.metadata as Record<string, unknown>)
                    : {};
                const localCurrency = getImportTransactionCurrency(transaction);
                const localAmount = getLocalAmountForValuation(transaction);
                const valuationMode = readValuationMode(transaction);
                const manualBaseAmount = Number(metadata.manualBaseAmount || 0);
                const manualFxRate = Number(metadata.manualFxRate || 0);
                const derivedBaseAmount =
                  valuationMode === "manual_base" && manualBaseAmount > 0
                    ? manualBaseAmount
                    : valuationMode === "manual_fx" &&
                        manualFxRate > 0 &&
                        localAmount > 0
                      ? localAmount * manualFxRate
                      : 0;
                const isReimbursement =
                  transaction.entryTypeOverride === "reimbursement" ||
                  transaction.linkage?.type === "reimbursement";
                const linkedCount =
                  transaction.linkage?.type === "reimbursement"
                    ? transaction.linkage.reimbursesAllocations?.length || 0
                    : 0;
                return (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {isFundingIn && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-green/10 px-2 py-0.5 text-xs font-medium text-green dark:text-green-light">
                          <ArrowDownToLine className="h-3.5 w-3.5" />
                          Funding In
                        </span>
                      )}
                      {isFundingOut && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                          <ArrowUpFromLine className="h-3.5 w-3.5" />
                          Funding Out Override
                        </span>
                      )}
                      {isConversion && (
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                            isConversionResolved
                              ? "bg-primary/10 text-primary"
                              : "bg-warning/15 text-warning"
                          }`}
                        >
                          <ArrowRightLeft className="h-3.5 w-3.5" />
                          {conversionReview.mode === "link_existing"
                            ? "Conversion Linked"
                            : conversionReview.mode === "skip_duplicate"
                              ? "Conversion Skipped"
                              : conversionReview.mode === "internal"
                                ? "Internal Conversion"
                                : conversionReview.mode === "funding_out" ||
                                    isFundingOut
                                  ? "Conversion as Funding Out"
                                  : "Conversion Unreviewed"}
                        </span>
                      )}
                      {isReimbursement && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-green/10 px-2 py-0.5 text-xs font-medium text-green dark:text-green-light">
                          <Receipt className="h-3.5 w-3.5" />
                          Reimbursement ({linkedCount} linked)
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant={isFundingIn ? "secondary" : "primary"}
                        size="sm"
                        onClick={() => toggleFundingInOverride(index)}
                        leftIcon={<ArrowDownToLine className="h-4 w-4" />}
                        disabled={!isFundingIn && Number(transaction.amountIn || 0) <= 0}
                      >
                        {isFundingIn ? "Unmark Funding In" : "Mark as Funding In"}
                      </Button>
                      <Button
                        variant={isFundingOut ? "secondary" : "primary"}
                        size="sm"
                        onClick={() => handleToggleFundingOutOverride(index)}
                        leftIcon={<ArrowUpFromLine className="h-4 w-4" />}
                        disabled={isFundingIn || Number(transaction.amountOut || 0) <= 0}
                      >
                        {isFundingOut
                          ? "Unmark Funding Out"
                          : "Mark as Funding Out"}
                      </Button>
                      {isFundingOut && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => openFundingOutModal(index)}
                          leftIcon={<Pencil className="h-4 w-4" />}
                        >
                          Edit Funding Out Details
                        </Button>
                      )}
                      {isConversion && (
                        <Button
                          variant={isConversionResolved ? "secondary" : "primary"}
                          size="sm"
                          onClick={() => setConversionReviewOpen(true)}
                          leftIcon={<ArrowRightLeft className="h-4 w-4" />}
                        >
                          Review Conversion
                        </Button>
                      )}
                      <Button
                        variant={isReimbursement ? "secondary" : "primary"}
                        size="sm"
                        onClick={() =>
                          isReimbursement
                            ? clearReimbursementOverride(index)
                            : openReimbursementSelector(index)
                        }
                        leftIcon={<Receipt className="h-4 w-4" />}
                        disabled={
                          isFundingIn ||
                          (!isReimbursement && Number(transaction.amountIn || 0) <= 0)
                        }
                      >
                        {isReimbursement
                          ? "Unmark Reimbursement"
                          : "Mark as Reimbursement"}
                      </Button>
                    </div>

                    {isConversion &&
                      conversionReview.mode === "link_existing" &&
                      conversionCandidates.length > 0 && (
                        <div className="rounded-md border border-stroke/70 bg-gray-1/50 px-3 py-2 text-xs text-dark-5 dark:border-dark-3 dark:bg-dark-3/40 dark:text-dark-6">
                          Linked to existing conversion:
                          <span className="ml-1 font-medium text-dark dark:text-white">
                            {conversionCandidates.find(
                              (item) => item.id === conversionReview.linkedFundingId,
                            )?.description || conversionReview.linkedFundingId}
                          </span>
                        </div>
                      )}

                    {!isFundingOut && (
                      <div className="rounded-md border border-stroke/70 bg-gray-1/40 p-3 dark:border-dark-3 dark:bg-dark-3/30">
                        <div className="mb-2 flex items-center gap-2">
                          <ArrowRightLeft className="h-3.5 w-3.5 text-primary" />
                          <p className="text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                            FX / Amount Details
                          </p>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <div>
                            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                              Valuation Mode
                            </label>
                            <Select
                              value={valuationMode}
                              onChange={(value) =>
                                updateTransactionMetadata(index, (nextMetadata) => {
                                  nextMetadata.baseValuationMode = value;
                                  if (value === "auto") {
                                    delete nextMetadata.manualBaseAmount;
                                    delete nextMetadata.manualFxRate;
                                  }
                                })
                              }
                              className="w-full"
                              buttonClassName="w-full"
                              options={[
                                { value: "auto", label: "Auto (parser/default)" },
                                { value: "manual_fx", label: "Manual FX to base" },
                                {
                                  value: "manual_base",
                                  label: "Manual Base Equivalent",
                                },
                              ]}
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                              Local Amount
                            </label>
                            <div className="flex h-10 items-center rounded-lg border border-stroke px-3 text-sm text-dark dark:border-dark-3 dark:text-white">
                              {localAmount > 0
                                ? `${localAmount.toFixed(2)} ${localCurrency}`
                                : "-"}
                            </div>
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                              Base Equivalent ({trip.baseCurrency})
                            </label>
                            <NumberInput
                              value={
                                valuationMode === "manual_base" && manualBaseAmount > 0
                                  ? String(manualBaseAmount)
                                  : valuationMode === "manual_fx" &&
                                      derivedBaseAmount > 0
                                    ? derivedBaseAmount.toFixed(4)
                                    : ""
                              }
                              onChange={(value) =>
                                updateTransactionMetadata(index, (nextMetadata) => {
                                  if (valuationMode !== "manual_base") return;
                                  const numeric = Number(value || 0);
                                  if (!(numeric > 0) || !(localAmount > 0)) {
                                    delete nextMetadata.manualBaseAmount;
                                    return;
                                  }
                                  nextMetadata.manualBaseAmount = numeric;
                                })
                              }
                              placeholder="Auto"
                              disabled={valuationMode !== "manual_base"}
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                              FX to Base ({trip.baseCurrency}/{localCurrency})
                            </label>
                            <NumberInput
                              value={
                                valuationMode === "manual_fx" && manualFxRate > 0
                                  ? String(manualFxRate)
                                  : ""
                              }
                              onChange={(value) =>
                                updateTransactionMetadata(index, (nextMetadata) => {
                                  if (valuationMode !== "manual_fx") return;
                                  const numeric = Number(value || 0);
                                  if (!(numeric > 0)) {
                                    delete nextMetadata.manualFxRate;
                                    return;
                                  }
                                  nextMetadata.manualFxRate = numeric;
                                })
                              }
                              placeholder="Auto"
                              disabled={valuationMode !== "manual_fx"}
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                              Fee Amount
                            </label>
                            <NumberInput
                              value={String(metadata.feeAmount || "")}
                              onChange={(value) =>
                                updateTransactionMetadata(index, (nextMetadata) => {
                                  const numeric = Number(value || 0);
                                  if (!(numeric > 0)) {
                                    delete nextMetadata.feeAmount;
                                    return;
                                  }
                                  nextMetadata.feeAmount = numeric;
                                })
                              }
                              placeholder="Optional"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                              Fee Currency
                            </label>
                            <Select
                              value={String(metadata.feeCurrency || localCurrency)}
                              onChange={(value) =>
                                updateTransactionMetadata(index, (nextMetadata) => {
                                  nextMetadata.feeCurrency = value;
                                })
                              }
                              className="w-full"
                              buttonClassName="w-full"
                              options={currencyOptions}
                            />
                          </div>
                        </div>

                        {isConversion && (
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <div>
                              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                                From Amount
                              </label>
                              <NumberInput
                                value={String(metadata.fromAmount || "")}
                                onChange={(value) =>
                                  updateTransactionMetadata(index, (nextMetadata) => {
                                    const numeric = Number(value || 0);
                                    if (!(numeric > 0)) {
                                      delete nextMetadata.fromAmount;
                                      return;
                                    }
                                    nextMetadata.fromAmount = numeric;
                                  })
                                }
                                placeholder="From amount"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                                From Currency
                              </label>
                              <Select
                                value={String(metadata.fromCurrency || localCurrency)}
                                onChange={(value) =>
                                  updateTransactionMetadata(index, (nextMetadata) => {
                                    nextMetadata.fromCurrency = value;
                                  })
                                }
                                className="w-full"
                                buttonClassName="w-full"
                                options={currencyOptions}
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                                To Amount
                              </label>
                              <NumberInput
                                value={String(metadata.toAmount || "")}
                                onChange={(value) =>
                                  updateTransactionMetadata(index, (nextMetadata) => {
                                    const numeric = Number(value || 0);
                                    if (!(numeric > 0)) {
                                      delete nextMetadata.toAmount;
                                      return;
                                    }
                                    nextMetadata.toAmount = numeric;
                                  })
                                }
                                placeholder="To amount"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                                To Currency
                              </label>
                              <Select
                                value={String(metadata.toCurrency || localCurrency)}
                                onChange={(value) =>
                                  updateTransactionMetadata(index, (nextMetadata) => {
                                    nextMetadata.toCurrency = value;
                                  })
                                }
                                className="w-full"
                                buttonClassName="w-full"
                                options={currencyOptions}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {isFundingOut && fundingOutConfig && (
                      <div className="grid gap-2 text-xs text-dark-5 dark:text-dark-6 sm:grid-cols-2">
                        <div>
                          <span className="font-medium text-dark dark:text-white">
                            Destination:
                          </span>{" "}
                          {fundingOutConfig.destinationType === "trip"
                            ? "Another Trip"
                            : fundingOutConfig.destinationType === "bank"
                              ? "Back to Bank"
                              : "External"}
                        </div>
                        <div>
                          <span className="font-medium text-dark dark:text-white">
                            Currency:
                          </span>{" "}
                          {fundingOutConfig.destinationCurrency}
                        </div>
                        <div>
                          <span className="font-medium text-dark dark:text-white">
                            Destination Amount:
                          </span>{" "}
                          {fundingOutConfig.destinationAmount || "-"}
                        </div>
                        <div>
                          <span className="font-medium text-dark dark:text-white">
                            FX Rate:
                          </span>{" "}
                          {fundingOutConfig.fxRate || "-"}
                        </div>
                        <div>
                          <span className="font-medium text-dark dark:text-white">
                            Fee:
                          </span>{" "}
                          {fundingOutConfig.feeAmount || "-"}{" "}
                          {fundingOutConfig.feeCurrency}
                        </div>
                      </div>
                    )}
                  </div>
                );
              }}
              reviewActionLeft={
                <div className="flex min-w-[420px] items-center gap-3">
                  <div className="relative min-w-[320px]">
                    <label className="pointer-events-none absolute -top-4 left-0 text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                      Target wallet
                    </label>
                    <Select
                      value={importForm.walletId}
                      onChange={(value) =>
                        setImportForm((prev) => ({ ...prev, walletId: value }))
                      }
                      className="w-full"
                      buttonClassName="w-full"
                      disabled={isStatementWalletRouted}
                      options={[
                        {
                          value: "",
                          label: isStatementWalletRouted
                            ? "Auto-routed by provider + currency"
                            : "Auto-create / auto-detect",
                        },
                        ...wallets.map((wallet) => ({
                          value: wallet.id,
                          label: `${wallet.name} (${wallet.currency})`,
                        })),
                      ]}
                    />
                  </div>
                  <Button
                    variant={unresolvedConversionIndices.length > 0 ? "primary" : "secondary"}
                    onClick={() => setConversionReviewOpen(true)}
                    leftIcon={<ArrowRightLeft className="h-4 w-4" />}
                  >
                    {unresolvedConversionIndices.length > 0
                      ? `Review Conversions (${unresolvedConversionIndices.length})`
                      : "Review Conversions"}
                  </Button>
                </div>
              }
            />
          </div>
        </div>
      )}

      {conversionReviewOpen && tripImportStep === "review" && (
        <div
          className="fixed inset-0 z-[75] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={() => setConversionReviewOpen(false)}
        >
          <div
            className="flex h-[80vh] w-full max-w-5xl flex-col rounded-lg border border-stroke bg-white shadow-card-2 dark:border-dark-3 dark:bg-dark-2"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-stroke px-6 py-4 dark:border-dark-3">
              <h3 className="text-lg font-semibold text-dark dark:text-white">
                Conversion Review
              </h3>
              <p className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                Review each conversion row as internal transfer, funding out, or
                duplicate-link to an existing conversion.
              </p>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
              {selectedConversionRows.length === 0 ? (
                <p className="text-sm text-dark-5 dark:text-dark-6">
                  No selected conversion rows.
                </p>
              ) : (
                selectedConversionRows.map(
                  ({ index, transaction, review, candidates, inBatchHints }) => {
                  const metadata =
                    transaction.metadata &&
                    typeof transaction.metadata === "object"
                      ? (transaction.metadata as Record<string, unknown>)
                      : {};
                  const selectedLinkedFundingId =
                    review.linkedFundingId || candidates[0]?.id || "";
                  const hasCandidates = candidates.length > 0;
                  const isFundingOut =
                    transaction.entryTypeOverride === "funding_out";
                  const resolved = isConversionDecisionResolved(transaction);

                  return (
                    <div
                      key={`${transaction.date}-${transaction.description}-${index}`}
                      className="rounded-lg border border-stroke bg-gray-1/40 p-4 dark:border-dark-3 dark:bg-dark-3/40"
                    >
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-dark dark:text-white">
                          {transaction.description}
                        </p>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            resolved
                              ? "bg-primary/10 text-primary"
                              : "bg-warning/15 text-warning"
                          }`}
                        >
                          {resolved ? "Reviewed" : "Pending review"}
                        </span>
                      </div>

                      <div className="grid gap-2 text-xs text-dark-5 dark:text-dark-6 sm:grid-cols-2">
                        <div>
                          <span className="font-medium text-dark dark:text-white">
                            Date:
                          </span>{" "}
                          {transaction.date}
                        </div>
                        <div>
                          <span className="font-medium text-dark dark:text-white">
                            Parsed conversion:
                          </span>{" "}
                          {formatConversionAmount(
                            metadata.fromAmount,
                            metadata.fromCurrency,
                          )}{" "}
                          →{" "}
                          {formatConversionAmount(
                            metadata.toAmount,
                            metadata.toCurrency,
                          )}
                        </div>
                      </div>

                      <div className="mt-3 grid gap-3 md:grid-cols-[260px_1fr]">
                        <div>
                          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                            Decision
                          </label>
                          <Select
                            value={
                              isFundingOut
                                ? "funding_out"
                                : review.mode === "unreviewed"
                                  ? ""
                                  : review.mode
                            }
                            onChange={(value) => {
                              if (!value) {
                                applyConversionDecision(index, "unreviewed");
                                return;
                              }
                              if (value === "funding_out") {
                                applyConversionDecision(index, "funding_out");
                                return;
                              }
                              if (value === "link_existing") {
                                if (!hasCandidates) {
                                  showModal(
                                    "warning",
                                    "No Match Candidates",
                                    "No compatible conversion candidates were found to link.",
                                  );
                                  return;
                                }
                                applyConversionDecision(
                                  index,
                                  "link_existing",
                                  selectedLinkedFundingId,
                                );
                                return;
                              }
                              applyConversionDecision(
                                index,
                                value as ConversionDecisionMode,
                              );
                            }}
                            className="w-full"
                            buttonClassName="w-full"
                            options={[
                              { value: "", label: "Select decision" },
                              { value: "internal", label: "Internal Conversion" },
                              { value: "funding_out", label: "Funding Out" },
                              { value: "skip_duplicate", label: "Skip Duplicate Row" },
                              {
                                value: "link_existing",
                                label: "Link Existing Conversion",
                              },
                            ]}
                          />
                        </div>

                        <div className="space-y-2">
                          {inBatchHints.length > 0 && (
                            <div className="rounded-md border border-stroke/70 bg-gray-1/60 px-3 py-2 text-xs text-dark-5 dark:border-dark-3 dark:bg-dark-3/30 dark:text-dark-6">
                              Possible mirrored conversion row(s) in this same
                              import:{" "}
                              <span className="font-medium text-dark dark:text-white">
                                {inBatchHints.map((hint) => `#${hint + 1}`).join(", ")}
                              </span>
                              . Keep one row as internal conversion and mark the
                              mirrored row as
                              <span className="font-medium text-dark dark:text-white">
                                {" "}
                                Skip Duplicate Row
                              </span>
                              .
                            </div>
                          )}
                          {hasCandidates ? (
                            <>
                              <div className="flex flex-wrap items-end gap-2">
                                <div className="min-w-0 flex-1">
                                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                                    Suggested existing conversion
                                  </label>
                                  <Select
                                    value={selectedLinkedFundingId}
                                    onChange={(value) =>
                                      applyConversionDecision(
                                        index,
                                        "link_existing",
                                        value,
                                      )
                                    }
                                    className="w-full"
                                    buttonClassName="w-full"
                                    options={candidates.map((candidate) => ({
                                      value: candidate.id,
                                      label: `${candidate.sourceAmount.toFixed(2)} ${
                                        candidate.sourceCurrency
                                      } → ${candidate.destinationAmount.toFixed(2)} ${
                                        candidate.destinationCurrency
                                      }`,
                                    }))}
                                  />
                                </div>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() =>
                                    applyConversionDecision(
                                      index,
                                      "link_existing",
                                      candidates[0]?.id,
                                    )
                                  }
                                  leftIcon={<Link2 className="h-4 w-4" />}
                                >
                                  Link Recommended
                                </Button>
                              </div>
                              <p className="text-xs text-dark-5 dark:text-dark-6">
                                Top recommendation: {candidates[0].description} •{" "}
                                {candidates[0].sourceAmount.toFixed(2)}{" "}
                                {candidates[0].sourceCurrency} →{" "}
                                {candidates[0].destinationAmount.toFixed(2)}{" "}
                                {candidates[0].destinationCurrency}
                              </p>
                            </>
                          ) : (
                            <p className="text-xs text-dark-5 dark:text-dark-6">
                              No existing conversion candidates detected for this row.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                },
                )
              )}
            </div>

            <div className="flex items-center justify-between border-t border-stroke px-6 py-4 dark:border-dark-3">
              <p className="text-xs text-dark-5 dark:text-dark-6">
                Pending: {unresolvedConversionIndices.length}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setConversionReviewOpen(false)}
                >
                  Close
                </Button>
                <Button
                  variant="primary"
                  onClick={() => setConversionReviewOpen(false)}
                  disabled={unresolvedConversionIndices.length > 0}
                >
                  Done
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeFundingOutIndex !== null && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={closeFundingOutModal}
        >
          <div
            className="w-full max-w-2xl rounded-lg border border-stroke bg-white shadow-card-2 dark:border-dark-3 dark:bg-dark-2"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-stroke px-6 py-4 dark:border-dark-3">
              <h3 className="text-lg font-semibold text-dark dark:text-white">
                Configure Funding Out
              </h3>
              <p className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                {tripImportEditedTransactions[activeFundingOutIndex]?.description ||
                  "Selected transaction"}
              </p>
            </div>

            <div className="space-y-4 p-6">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Destination
                  </label>
                  <Select
                    value={fundingOutDraft.destinationType}
                    onChange={(value) =>
                      setFundingOutDraft((prev) => ({
                        ...prev,
                        destinationType: value as FundingOutDestinationType,
                        destinationCurrency:
                          value === "bank"
                            ? trip.baseCurrency
                            : prev.destinationCurrency,
                      }))
                    }
                    className="w-full"
                    buttonClassName="w-full"
                    menuPlacement="down"
                    options={[
                      { value: "bank", label: "Back to Bank" },
                      { value: "trip", label: "Another Trip" },
                      { value: "external", label: "External" },
                    ]}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Destination Currency
                  </label>
                  <Select
                    value={fundingOutDraft.destinationCurrency}
                    onChange={(value) =>
                      fundingOutDraft.destinationType === "bank"
                        ? undefined
                        : setFundingOutDraft((prev) => ({
                            ...prev,
                            destinationCurrency: value,
                          }))
                    }
                    className="w-full"
                    buttonClassName={`w-full ${
                      fundingOutDraft.destinationType === "bank"
                        ? "pointer-events-none opacity-70"
                        : ""
                    }`}
                    menuPlacement="down"
                    options={
                      fundingOutDraft.destinationType === "bank"
                        ? [{ value: trip.baseCurrency, label: trip.baseCurrency }]
                        : currencyOptions
                    }
                  />
                </div>
              </div>

              {fundingOutDraft.destinationType === "trip" && (
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Destination Trip
                  </label>
                  <Select
                    value={fundingOutDraft.destinationTripId}
                    onChange={(value) =>
                      setFundingOutDraft((prev) => ({
                        ...prev,
                        destinationTripId: value,
                      }))
                    }
                    className="w-full"
                    buttonClassName="w-full"
                    menuPlacement="down"
                    options={[
                      { value: "", label: "Select destination trip" },
                      ...allTrips
                        .filter((item) => item.id !== trip.id)
                        .map((item) => ({
                          value: item.id,
                          label: item.name,
                        })),
                    ]}
                  />
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                  Destination Value Input
                </label>
                <div className="flex flex-wrap items-center gap-4">
                  <label className="inline-flex items-center gap-2 text-xs text-dark dark:text-white">
                    <Checkbox
                      checked={fundingOutDraft.inputMode === "amount"}
                      onChange={() =>
                        setFundingOutDraft((prev) => ({
                          ...prev,
                          inputMode: "amount",
                        }))
                      }
                    />
                    Destination amount
                  </label>
                  <label className="inline-flex items-center gap-2 text-xs text-dark dark:text-white">
                    <Checkbox
                      checked={fundingOutDraft.inputMode === "fxRate"}
                      onChange={() =>
                        setFundingOutDraft((prev) => ({
                          ...prev,
                          inputMode: "fxRate",
                        }))
                      }
                    />
                    FX rate
                  </label>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Destination Amount
                  </label>
                  <NumberInput
                    value={fundingOutDraft.destinationAmount}
                    onChange={(event) =>
                      setFundingOutDraft((prev) => ({
                        ...prev,
                        destinationAmount: event.target.value,
                      }))
                    }
                    disabled={fundingOutDraft.inputMode !== "amount"}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    FX Rate
                  </label>
                  <NumberInput
                    value={fundingOutDraft.fxRate}
                    onChange={(event) =>
                      setFundingOutDraft((prev) => ({
                        ...prev,
                        fxRate: event.target.value,
                      }))
                    }
                    disabled={fundingOutDraft.inputMode !== "fxRate"}
                    placeholder="1.0000"
                  />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Fee Amount
                  </label>
                  <NumberInput
                    value={fundingOutDraft.feeAmount}
                    onChange={(event) =>
                      setFundingOutDraft((prev) => ({
                        ...prev,
                        feeAmount: event.target.value,
                      }))
                    }
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Fee Currency
                  </label>
                  <Select
                    value={fundingOutDraft.feeCurrency}
                    onChange={(value) =>
                      setFundingOutDraft((prev) => ({
                        ...prev,
                        feeCurrency: value,
                      }))
                    }
                    className="w-full"
                    buttonClassName="w-full"
                    menuPlacement="down"
                    options={currencyOptions}
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-stroke px-6 py-4 dark:border-dark-3">
              <Button variant="secondary" onClick={closeFundingOutModal}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleSaveFundingOutDraft}>
                Save Funding Out
              </Button>
            </div>
          </div>
        </div>
      )}

      {reimbursementModalOpen && reimbursementTargetIndex !== null && (
        <TripReimbursementSelectorModal
          isOpen={reimbursementModalOpen}
          onClose={() => {
            setReimbursementModalOpen(false);
            setReimbursementTargetIndex(null);
          }}
          onConfirm={handleConfirmReimbursement}
          tripId={trip.id}
          currentIndex={reimbursementTargetIndex}
          transactions={tripImportEditedTransactions}
          currentLinkage={tripImportEditedTransactions[reimbursementTargetIndex]?.linkage || null}
          categories={localCategories}
          wallets={wallets}
          baseCurrency={trip.baseCurrency}
        />
      )}

      <Modal
        isOpen={modalState.isOpen}
        onClose={closeModal}
        type={modalState.type}
        title={modalState.title}
        message={modalState.message}
      />

      <AddCategoryModal
        isOpen={isAddCategoryModalOpen}
        onClose={() => setIsAddCategoryModalOpen(false)}
        onAdd={handleAddTripCategory}
      />
    </div>
  );
}
