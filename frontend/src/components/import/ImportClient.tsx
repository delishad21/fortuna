"use client";

import { useRef, useState } from "react";
import { stageStatementImport } from "@/app/actions/agentDrafts";
import { upsertAccountNumber } from "@/app/actions/accountNumbers";
import {
  getPaylahInternalPreferenceState,
  setPaylahInternalPreference,
} from "@/app/actions/importRules";
import { Modal, type ModalType } from "@/components/ui/Modal";
import { NewAccountColorModal } from "@/components/ui/NewAccountColorModal";
import { UploadSection, type FileUploadState } from "./UploadSection";
import { detectNewAccountIdentifiers } from "./importAccountMapping";

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

type Draft = Record<string, any> & { rows: Array<Record<string, any>> };

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
  initialAccountNumbers: AccountIdentifier[];
  parserOptions: ParserOption[];
  /** Called with the staged drafts once the statements are parsed and ready for review. */
  onStaged: (drafts: Draft[]) => void;
}

/**
 * Uploads bank statements as staged imports. Review, duplicate checks and commit
 * happen on the staged drafts, the same as imports staged from chat.
 */
export function ImportClient({
  initialAccountNumbers,
  parserOptions,
  onStaged,
}: ImportClientProps) {
  const [files, setFiles] = useState<FileUploadState[]>([]);
  const [selectedParser, setSelectedParser] = useState<string>(
    parserOptions[0]?.value || "generic_csv",
  );
  const [accountIdentifiers, setAccountIdentifiers] = useState<
    AccountIdentifier[]
  >(initialAccountNumbers);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stagedDrafts, setStagedDrafts] = useState<Draft[]>([]);
  const [pendingAccountColors, setPendingAccountColors] = useState<Map<string, string>>(
    new Map(),
  );
  const [isPaylahPromptOpen, setIsPaylahPromptOpen] = useState(false);
  const [isPaylahPromptConfirming, setIsPaylahPromptConfirming] =
    useState(false);
  const [pendingUploadAfterPaylahPrompt, setPendingUploadAfterPaylahPrompt] =
    useState(false);
  const paylahPromptConfirmedRef = useRef(false);

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

  const showModal = (type: ModalType, title: string, message: string) => {
    setModalState({ isOpen: true, type, title, message });
  };

  const closeModal = () => {
    setModalState((prev) => ({ ...prev, isOpen: false }));
  };

  const handleFilesChange = (nextFiles: FileUploadState[]) => {
    setFiles(nextFiles);
    setError(null);
  };

  const finish = (drafts: Draft[]) => {
    setFiles([]);
    setStagedDrafts([]);
    setPendingAccountColors(new Map());
    onStaged(drafts);
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
    setFiles((prev) =>
      prev.map((f) =>
        f.status === "pending" || f.status === "error"
          ? { ...f, status: "parsing" as const, error: undefined }
          : f,
      ),
    );

    const drafts: Draft[] = [];
    const failures = new Map<File, string>();
    for (const fileState of pendingFiles) {
      try {
        const formData = new FormData();
        formData.append("file", fileState.file);
        formData.append("parserId", fileState.parserId || selectedParser);
        const { draft } = await stageStatementImport(formData);
        drafts.push(draft as Draft);
      } catch (err) {
        failures.set(
          fileState.file,
          err instanceof Error ? err.message : "Failed to parse file",
        );
      }
    }

    setFiles((prev) =>
      prev.map((f) =>
        f.status !== "parsing"
          ? f
          : failures.has(f.file)
            ? { ...f, status: "error" as const, error: failures.get(f.file) }
            : { ...f, status: "success" as const },
      ),
    );
    setIsUploading(false);

    if (drafts.length === 0) {
      setError("All files failed to parse");
      return;
    }
    if (failures.size > 0) {
      setError(
        `${failures.size} file${failures.size === 1 ? "" : "s"} failed to parse. The rest are staged under the Staged tab.`,
      );
    }

    const newAccounts = detectNewAccountIdentifiers(
      drafts.flatMap((draft) =>
        draft.rows.map((row) => ({
          accountIdentifier: row.currentPayload?.accountIdentifier,
        })),
      ),
      accountIdentifiers,
    );
    if (newAccounts.length > 0) {
      setStagedDrafts(drafts);
      setPendingAccountColors(
        new Map(
          newAccounts.map((newAccount, index) => [
            newAccount,
            PRESET_COLORS[index % PRESET_COLORS.length],
          ]),
        ),
      );
      return;
    }
    if (failures.size === 0) finish(drafts);
    else setStagedDrafts(drafts);
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
      finish(stagedDrafts);
    } catch (err) {
      showModal(
        "error",
        "Failed to Save Accounts",
        err instanceof Error ? err.message : "Failed to save accounts",
      );
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 p-8 overflow-hidden">
        <UploadSection
          files={files}
          selectedParser={selectedParser}
          parserOptions={parserOptions}
          isUploading={isUploading}
          error={error}
          accountMismatchError={null}
          onFilesChange={handleFilesChange}
          onParserChange={setSelectedParser}
          onUpload={handleUpload}
        />
        {stagedDrafts.length > 0 && pendingAccountColors.size === 0 && (
          <button
            type="button"
            className="mt-4 text-sm font-medium text-primary"
            onClick={() => finish(stagedDrafts)}
          >
            Review {stagedDrafts.length} staged statement
            {stagedDrafts.length === 1 ? "" : "s"} →
          </button>
        )}
      </div>

      <NewAccountColorModal
        isOpen={pendingAccountColors.size > 0}
        accounts={Array.from(pendingAccountColors.entries()).map(
          ([accountIdentifier, defaultColor]) => ({
            accountIdentifier,
            defaultColor,
          }),
        )}
        onConfirm={handleConfirmAccountColors}
        onCancel={() => {
          // The drafts stay staged; unknown accounts can be assigned per row in review.
          setPendingAccountColors(new Map());
          finish(stagedDrafts);
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
    </div>
  );
}
