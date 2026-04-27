"use client";

import type { Category } from "@/app/actions/categories";
import type { Wallet } from "@/app/actions/trips";
import { FileUploadDropzone } from "@/components/import/FileUploadDropzone";
import { TransactionTable } from "@/components/transaction-table/TransactionTable";
import type {
  ParseResult as ImportParseResult,
  Transaction as ImportTransaction,
} from "@/components/transaction-table/types";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import type { ParserOption } from "@/lib/parsers";
import { Link2, PlaneTakeoff } from "lucide-react";

interface TripImportStatementModalProps {
  isOpen: boolean;
  onClose: () => void;
  isBusy: boolean;
  tripImportStep: "setup" | "review";
  setTripImportStep: (step: "setup" | "review") => void;
  tripImportParsedData: ImportParseResult | null;
  tripImportEditedTransactions: ImportTransaction[];
  tripImportSelectedIndices: Set<number>;
  localCategories: Category[];
  tripParserOptions: ParserOption[];
  wallets: Wallet[];
  importForm: {
    parserId: string;
    walletId: string;
  };
  setImportForm: (
    updater: (
      prev: TripImportStatementModalProps["importForm"],
    ) => TripImportStatementModalProps["importForm"],
  ) => void;
  selectedFile: File | null;
  setSelectedFile: (file: File | null) => void;
  supplementalFile: File | null;
  setSupplementalFile: (file: File | null) => void;
  onStartReview: () => void;
  onUpdateTransaction: (index: number, field: string, value: unknown) => void;
  onCommitReview: () => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onSelectVisible: (indices: number[]) => void;
  onDeselectVisible: (indices: number[]) => void;
  onToggleSelection: (index: number) => void;
  onAddCategoryClick: () => void;
  onOpenFundingModal: () => void;
  resetReviewState: () => void;
}

export function TripImportStatementModal({
  isOpen,
  onClose,
  isBusy,
  tripImportStep,
  setTripImportStep,
  tripImportParsedData,
  tripImportEditedTransactions,
  tripImportSelectedIndices,
  localCategories,
  tripParserOptions,
  wallets,
  importForm,
  setImportForm,
  selectedFile,
  setSelectedFile,
  supplementalFile,
  setSupplementalFile,
  onStartReview,
  onUpdateTransaction,
  onCommitReview,
  onSelectAll,
  onDeselectAll,
  onSelectVisible,
  onDeselectVisible,
  onToggleSelection,
  onAddCategoryClick,
  onOpenFundingModal,
  resetReviewState,
}: TripImportStatementModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 dark:bg-black/70 p-4 flex items-center justify-center"
      onClick={() => {
        onClose();
        resetReviewState();
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className={`w-full ${
          tripImportStep === "review" ? "max-w-[95vw]" : "max-w-2xl"
        } bg-white dark:bg-dark-2 rounded-lg border border-stroke dark:border-dark-3 shadow-card-2 ${
          tripImportStep === "review" ? "h-[90vh]" : ""
        }`}
      >
        <div className="px-6 py-4 border-b border-stroke dark:border-dark-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-dark dark:text-white">
            {tripImportStep === "review"
              ? "Review Trip Statement Import"
              : "Import Trip Statement"}
          </h3>
          <div className="inline-flex items-center gap-1 text-xs text-dark-5 dark:text-dark-6">
            <PlaneTakeoff className="h-3.5 w-3.5" />
            Trip-only parsers
          </div>
        </div>
        {tripImportStep === "setup" && (
          <>
            <div className="p-6 space-y-4">
              <div className="rounded-lg border border-stroke dark:border-dark-3 bg-gray-1/40 dark:bg-dark-3/40 px-3 py-2 text-xs text-dark-5 dark:text-dark-6">
                Wallets are auto-created by provider and currency (for example
                <span className="font-medium text-dark dark:text-white">
                  {" "}
                  Revolut USD
                </span>
                ,
                <span className="font-medium text-dark dark:text-white">
                  {" "}
                  YouTrip JPY
                </span>
                ) based on the imported statement transactions.
              </div>
              <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Parser
                  </label>
                  <Select
                    value={importForm.parserId}
                    onChange={(value) => {
                      setImportForm((prev) => ({
                        ...prev,
                        parserId: value,
                      }));
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
                      setImportForm((prev) => ({
                        ...prev,
                        walletId: value,
                      }))
                    }
                    className="w-full"
                    buttonClassName="w-full"
                    options={[
                      { value: "", label: "Auto-create / auto-detect" },
                      ...wallets.map((wallet) => ({
                        value: wallet.id,
                        label: `${wallet.name} (${wallet.currency})`,
                      })),
                    ]}
                  />
                </div>
              </div>

              <div
                className={`grid gap-3 md:grid-cols-1 ${
                  importForm.parserId === "revolut_statement"
                    ? "h-[28rem] grid-rows-2"
                    : "h-56 grid-rows-1"
                }`}
              >
                <div className="min-h-0 min-w-0 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                      Statement file
                    </label>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                      Required
                    </span>
                  </div>
                  <div className="flex-1 min-h-0 min-w-0">
                    <FileUploadDropzone
                      onFilesAdd={(files) => { if (files[0]) setSelectedFile(files[0]); }}
                      accept=".pdf,.csv"
                    />
                  </div>
                </div>
                {importForm.parserId === "revolut_statement" && (
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
            <div className="px-6 py-4 border-t border-stroke dark:border-dark-3 flex items-center justify-end gap-3">
              <Button
                variant="secondary"
                onClick={() => {
                  onClose();
                  setTripImportStep("setup");
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={onStartReview}
                disabled={isBusy || !selectedFile || !importForm.parserId}
              >
                {isBusy ? "Parsing..." : "Review Import"}
              </Button>
            </div>
          </>
        )}

        {tripImportStep === "review" && tripImportParsedData && (
          <div className="h-[calc(90vh-72px)] grid gap-4 p-4 lg:grid-cols-[minmax(0,2fr)_340px]">
            <div className="min-h-0">
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
                onUpdateTransaction={onUpdateTransaction}
                onAccountIdentifierChange={() => {}}
                onImport={onCommitReview}
                onSelectAll={onSelectAll}
                onDeselectAll={onDeselectAll}
                onSelectVisible={onSelectVisible}
                onDeselectVisible={onDeselectVisible}
                onToggleSelection={onToggleSelection}
                onAddCategoryClick={onAddCategoryClick}
                onBack={() => setTripImportStep("setup")}
                deferCellCommit
                lockLinkedReimbursements={false}
              />
            </div>
            <div className="min-h-0 space-y-3">
              <div className="rounded-lg border border-stroke dark:border-dark-3 p-3">
                <p className="text-sm font-semibold text-dark dark:text-white">
                  Wallet Crediting
                </p>
                <p className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                  Choose where this statement should be credited by default.
                  Auto mode creates or matches wallet by provider + currency.
                </p>
                <div className="mt-3">
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Target wallet
                  </label>
                  <Select
                    value={importForm.walletId}
                    onChange={(value) =>
                      setImportForm((prev) => ({
                        ...prev,
                        walletId: value,
                      }))
                    }
                    className="w-full"
                    buttonClassName="w-full"
                    options={[
                      { value: "", label: "Auto-create / auto-detect" },
                      ...wallets.map((wallet) => ({
                        value: wallet.id,
                        label: `${wallet.name} (${wallet.currency})`,
                      })),
                    ]}
                  />
                </div>
              </div>

              <div className="rounded-lg border border-stroke dark:border-dark-3 p-3">
                <p className="text-sm font-semibold text-dark dark:text-white">
                  Funding Linkage Review
                </p>
                <p className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                  After import, topup/funding matches can be reviewed in the
                  Funding modal.
                </p>
                <div className="mt-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={onOpenFundingModal}
                    leftIcon={<Link2 className="h-4 w-4" />}
                  >
                    Open Funding Modal
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
