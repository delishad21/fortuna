"use client";

import { useRef } from "react";
import { Upload, XCircle, X, AlertCircle, FileText, Plus } from "lucide-react";
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

function truncateFileName(name: string, maxLength = 24): string {
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const firstFile = files[0]?.file ?? null;
  const pendingOrErrorFiles = files.filter(
    (f) => f.status === "pending" || f.status === "error",
  );
  const canParse = pendingOrErrorFiles.length > 0;

  const handleFileSelect = (file: File | null) => {
    if (!file) return;
    const newFile: FileUploadState = { file, status: "pending" };
    onFilesChange([...files, newFile]);
  };

  const handleRemoveFile = (index: number) => {
    onFilesChange(files.filter((_, i) => i !== index));
  };

  const handleAddMoreClick = () => {
    fileInputRef.current?.click();
  };

  const handleAddMoreFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files).map((file) => ({
        file,
        status: "pending" as const,
      }));
      onFilesChange([...files, ...newFiles]);
      e.target.value = "";
    }
  };

  return (
    <div className="flex gap-6 h-full">
      <div className="w-96 flex flex-col">
        <div className="flex items-center gap-2 mb-4">
          <Upload className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-dark dark:text-white uppercase tracking-wide">
            Upload Statement
          </h3>
        </div>

        <div className="flex-1 bg-white dark:bg-dark-2 rounded-lg border border-stroke dark:border-dark-3 p-6 flex flex-col">
          <div className="flex-1 flex flex-col gap-4">
            <div className="w-full">
              <label className="block text-sm font-medium text-dark dark:text-white mb-2">
                Select Parser
              </label>
              <Select
                value={selectedParser}
                options={parserOptions}
                onChange={onParserChange}
                className="w-full"
                buttonClassName="w-full min-w-0"
              />
            </div>

            <div className="flex-1 min-h-40">
              <FileUploadDropzone
                file={firstFile}
                onFileSelect={handleFileSelect}
              />
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.pdf"
              multiple
              className="hidden"
              onChange={handleAddMoreFiles}
            />

            <Button
              onClick={handleAddMoreClick}
              variant="secondary"
              className="w-full text-xs"
              leftIcon={<Plus className="h-3 w-3" />}
            >
              Add More Files
            </Button>

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

          {accountMismatchError && (
            <div className="mt-4 p-3 bg-warning/10 dark:bg-warning/20 border border-warning/30 dark:border-warning/40 rounded-lg flex items-start gap-2">
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
            <div className="mt-4 p-3 bg-red/10 dark:bg-red/20 border border-red/30 dark:border-red/40 rounded-lg flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red flex-shrink-0" />
              <p className="text-red text-sm">{error}</p>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-4 overflow-y-auto">
        {files.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-dark-5 dark:text-dark-6">
              <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm">Select or drop files to begin</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                Selected Files ({files.length})
              </h4>
              {files.some((f) => f.status === "error") && (
                <span className="text-xs text-red">
                  {files.filter((f) => f.status === "error").length} failed
                </span>
              )}
            </div>
            {files.map((fileState, index) => (
              <div
                key={`${fileState.file.name}-${index}`}
                className={`flex items-center gap-3 p-3 rounded-lg border ${
                  fileState.status === "error"
                    ? "bg-red/5 border-red/30 dark:bg-red/10"
                    : fileState.status === "parsing"
                      ? "bg-primary/5 border-primary/30 dark:bg-primary/10"
                      : fileState.status === "success"
                        ? "bg-green/5 border-green/30 dark:bg-green/10"
                        : "bg-gray-1 dark:bg-dark-3 border-stroke dark:border-dark-3"
                }`}
              >
                <FileText className="h-5 w-5 text-primary flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p
                    className="text-sm font-medium text-dark dark:text-white truncate"
                    title={fileState.file.name}
                  >
                    {truncateFileName(fileState.file.name)}
                  </p>
                  <p className="text-xs text-dark-5 dark:text-dark-6">
                    {(fileState.file.size / 1024).toFixed(1)} KB
                    {fileState.status === "error" && fileState.error && (
                      <span className="text-red ml-2">— {fileState.error}</span>
                    )}
                    {fileState.status === "parsing" && (
                      <span className="text-primary ml-2">Parsing...</span>
                    )}
                    {fileState.status === "success" && (
                      <span className="text-green ml-2">Ready</span>
                    )}
                  </p>
                </div>
                {fileState.status === "pending" && (
                  <button
                    onClick={() => handleRemoveFile(index)}
                    className="p-1 text-dark-5 hover:text-red transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {files.length > 0 && files[0] && (
          <div className="flex-1 min-h-0">
            <FilePreview file={files[0].file} />
          </div>
        )}
      </div>
    </div>
  );
}