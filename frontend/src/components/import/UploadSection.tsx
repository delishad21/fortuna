"use client";

import { useState } from "react";
import { Upload, XCircle, AlertCircle, FileText, Check, Loader2 } from "lucide-react";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { FileUploadDropzone } from "./FileUploadDropzone";
import { FilePreview } from "./FilePreview";

interface ParserOption {
  value: string;
  label: string;
  description: string;
}

export interface FileUploadState {
  file: File;
  status: "pending" | "parsing" | "success" | "error";
  parserId?: string;
  error?: string;
}

interface UploadSectionProps {
  files: FileUploadState[];
  selectedParser: string;
  parserOptions: ParserOption[];
  isUploading: boolean;
  error: string | null;
  accountMismatchError?: string | null;
  onFilesChange: (files: FileUploadState[]) => void;
  onParserChange: (parser: string) => void;
  onUpload: () => void;
}

function truncateFileName(name: string, maxLength = 28): string {
  if (!name || name.length <= maxLength) return name;
  const dotIndex = name.lastIndexOf(".");
  const extension = dotIndex > 0 ? name.slice(dotIndex) : "";
  const base = dotIndex > 0 ? name.slice(0, dotIndex) : name;
  const keepLeft = Math.max(10, Math.floor((maxLength - extension.length - 3) * 0.6));
  const keepRight = Math.max(8, maxLength - extension.length - 3 - keepLeft);
  const left = base.slice(0, keepLeft);
  const right = base.slice(-keepRight);
  return `${left}...${right}${extension}`;
}

export function UploadSection({
  files,
  selectedParser,
  parserOptions,
  isUploading,
  error,
  accountMismatchError,
  onFilesChange,
  onParserChange,
  onUpload,
}: UploadSectionProps) {
  const [selectedPreviewIndex, setSelectedPreviewIndex] = useState<number>(0);

  const handleFilesAdd = (newFiles: File[]) => {
    const existingKeys = new Set(
      files.map((f) => `${f.file.name}-${f.file.size}`),
    );
    const uniqueFiles = newFiles.filter(
      (file) => !existingKeys.has(`${file.name}-${file.size}`),
    );
    const duplicates = newFiles.length - uniqueFiles.length;

    if (duplicates > 0 && uniqueFiles.length === 0) {
      return;
    }

    const newFileStates: FileUploadState[] = uniqueFiles.map((file) => ({
      file,
      status: "pending" as const,
      parserId: selectedParser,
    }));
    const updated = [...files, ...newFileStates];
    onFilesChange(updated);
    if (files.length === 0 && updated.length > 0) {
      setSelectedPreviewIndex(0);
    }
  };

  const handleRemoveFile = (index: number) => {
    const updated = files.filter((_, i) => i !== index);
    onFilesChange(updated);
    if (selectedPreviewIndex >= updated.length) {
      setSelectedPreviewIndex(Math.max(0, updated.length - 1));
    }
  };

  const pendingOrErrorFiles = files.filter(
    (f) => f.status === "pending" || f.status === "error",
  );
  const canParse =
    pendingOrErrorFiles.length > 0 &&
    pendingOrErrorFiles.every((fileState) => !!fileState.parserId);
  const selectedFile = files[selectedPreviewIndex]?.file ?? null;

  const handleFileParserChange = (index: number, parserId: string) => {
    onFilesChange(
      files.map((fileState, fileIndex) =>
        fileIndex === index
          ? {
              ...fileState,
              parserId,
              error: undefined,
              status:
                fileState.status === "success" ? "pending" : fileState.status,
            }
          : fileState,
      ),
    );
  };

  return (
    <div className="flex gap-6 h-full overflow-hidden">
      <div className="w-96 flex flex-col h-full overflow-hidden">
        <div className="flex items-center gap-2 mb-4 flex-shrink-0">
          <Upload className="h-4 w-4 text-primary" />
          <h3 className="font-sans text-sm font-semibold text-dark dark:text-white uppercase tracking-wide">
            Upload Statement
          </h3>
        </div>

        <div className="flex-1 bg-white dark:bg-dark-2 rounded-lg border border-stroke dark:border-dark-3 p-4 flex flex-col gap-4 overflow-hidden">
          <div className="w-full flex-shrink-0">
            <label className="block text-sm font-medium text-dark dark:text-white mb-2">
              Parser for New Files
            </label>
            <Select
              value={selectedParser}
              options={parserOptions}
              onChange={onParserChange}
              className="w-full"
              buttonClassName="w-full min-w-0"
            />
          </div>

          <div className="h-32 min-h-[128px] flex-shrink-0">
            <FileUploadDropzone
              onFilesAdd={handleFilesAdd}
              compact
            />
          </div>

          {files.length > 0 && (
            <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-hidden">
              <div className="flex items-center justify-between flex-shrink-0">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                  Files ({files.length})
                </h4>
                {files.some((f) => f.status === "error") && (
                  <span className="text-xs text-red">
                    {files.filter((f) => f.status === "error").length} failed
                  </span>
                )}
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5">
                {files.map((fileState, index) => (
                  <div
                    key={`${fileState.file.name}-${index}`}
                    onClick={() => setSelectedPreviewIndex(index)}
                    className={`w-full flex items-center gap-2 p-2 rounded-md border text-left transition-colors ${
                      selectedPreviewIndex === index
                        ? "bg-primary/5 border-primary/30 dark:bg-primary/10"
                        : fileState.status === "error"
                          ? "bg-red/5 border-red/30 dark:bg-red/10 hover:bg-red/10"
                          : "bg-gray-1 dark:bg-dark-3 border-stroke dark:border-dark-3 hover:bg-gray-2 dark:hover:bg-dark-3/70"
                    }`}
                  >
                    <FileText className="h-4 w-4 text-primary flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-xs font-medium text-dark dark:text-white truncate"
                        title={fileState.file.name}
                      >
                        {truncateFileName(fileState.file.name)}
                      </p>
                      <p className="text-[10px] text-dark-5 dark:text-dark-6">
                        {(fileState.file.size / 1024).toFixed(1)} KB
                        {fileState.status === "error" && fileState.error && (
                          <span className="text-red ml-1">— {fileState.error}</span>
                        )}
                        {fileState.status === "parsing" && (
                          <span className="text-primary ml-1 flex items-center gap-1">
                            <Loader2 className="h-2.5 w-2.5 animate-spin" /> Parsing...
                          </span>
                        )}
                        {fileState.status === "success" && (
                          <span className="text-green ml-1 flex items-center gap-1">
                            <Check className="h-2.5 w-2.5" /> Ready
                          </span>
                        )}
                      </p>
                    </div>
                    <div
                      className="w-40 flex-shrink-0"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Select
                        value={fileState.parserId || selectedParser}
                        options={parserOptions}
                        onChange={(parserId) => handleFileParserChange(index, parserId)}
                        disabled={fileState.status === "parsing"}
                        className="w-full"
                        buttonClassName="w-full min-w-0 !py-1.5 !px-2 !text-xs"
                      />
                    </div>
                    <button
                      type="button"
                      aria-label={`Remove ${fileState.file.name}`}
                      title="Remove file"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveFile(index);
                      }}
                      disabled={isUploading || fileState.status === "parsing"}
                      className="p-1 text-dark-5 transition-colors flex-shrink-0 hover:text-red disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-dark-5"
                    >
                      <XCircle className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex-shrink-0 flex flex-col gap-2">
            {accountMismatchError && (
              <div className="p-3 bg-warning/10 dark:bg-warning/20 border border-warning/30 dark:border-warning/40 rounded-lg flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-warning flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-warning text-sm font-medium">
                    Account Mismatch
                  </p>
                  <p className="text-warning/80 text-xs mt-1">
                    {accountMismatchError}
                  </p>
                </div>
              </div>
            )}

            {error && (
              <div className="p-3 bg-red/10 dark:bg-red/20 border border-red/30 dark:border-red/40 rounded-lg flex items-center gap-2">
                <XCircle className="h-4 w-4 text-red flex-shrink-0" />
                <p className="text-red text-sm">{error}</p>
              </div>
            )}

            <Button
              onClick={onUpload}
              disabled={!canParse}
              isLoading={isUploading}
              leftIcon={<Upload className="h-4 w-4" />}
              className="w-full"
            >
              {isUploading ? "Parsing..." : `Parse ${pendingOrErrorFiles.length > 1 ? `${pendingOrErrorFiles.length} Files` : "File"}`}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-w-0 overflow-hidden">
        <FilePreview file={selectedFile} />
      </div>
    </div>
  );
}
