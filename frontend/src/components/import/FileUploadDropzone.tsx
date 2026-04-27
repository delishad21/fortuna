"use client";

import { useState } from "react";
import { Upload, FileText } from "lucide-react";

interface FileUploadDropzoneProps {
  onFilesAdd: (files: File[]) => void;
  accept?: string;
  compact?: boolean;
}

function truncateFileName(name: string, maxLength = 30): string {
  if (!name || name.length <= maxLength) return name;
  const dotIndex = name.lastIndexOf(".");
  const extension = dotIndex > 0 ? name.slice(dotIndex) : "";
  const base = dotIndex > 0 ? name.slice(0, dotIndex) : name;
  const keepLeft = Math.max(14, Math.floor((maxLength - extension.length - 3) * 0.6));
  const keepRight = Math.max(8, maxLength - extension.length - 3 - keepLeft);
  const left = base.slice(0, keepLeft);
  const right = base.slice(-keepRight);
  return `${left}...${right}${extension}`;
}

function formatSupportedFormats(accept: string): string {
  const tokens = accept
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return "Any";

  const labels: string[] = [];
  for (const token of tokens) {
    let label = token;
    if (token.startsWith(".")) {
      label = token.slice(1).toUpperCase();
    } else if (token === "*/*") {
      label = "Any file";
    } else if (token.toLowerCase() === "image/*") {
      label = "Image files";
    } else if (token.toLowerCase() === "application/pdf") {
      label = "PDF";
    } else if (token.toLowerCase() === "text/csv") {
      label = "CSV";
    } else if (token.endsWith("/*")) {
      const family = token.slice(0, -2);
      label = `${family.charAt(0).toUpperCase()}${family.slice(1)} files`;
    } else if (token.includes("/")) {
      const subtype = token.split("/")[1];
      label = subtype.toUpperCase();
    } else {
      label = token.toUpperCase();
    }
    if (label && !labels.includes(label)) {
      labels.push(label);
    }
  }
  return labels.join(", ");
}

export function FileUploadDropzone({
  onFilesAdd,
  accept = ".csv,.pdf",
  compact = false,
}: FileUploadDropzoneProps) {
  const [dragActive, setDragActive] = useState(false);
  const supportedFormatsLabel = formatSupportedFormats(accept);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files);
      onFilesAdd(files);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      onFilesAdd(files);
      e.target.value = "";
    }
  };

  return (
    <div
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
      style={{ contain: "inline-size" }}
      className={`w-full h-full min-w-0 max-w-full overflow-hidden border-2 border-dashed rounded-lg flex items-center justify-center transition-colors ${
        dragActive
          ? "border-primary bg-primary/10 dark:bg-primary/20"
          : "border-stroke dark:border-dark-3 hover:border-primary/50"
      }`}
    >
      <div className="flex w-full max-w-full min-w-0 flex-col items-center gap-2 overflow-hidden px-4">
        <div className={`${compact ? "p-2" : "p-3"} bg-gray-1 dark:bg-dark-3 rounded-full`}>
          <Upload className={`${compact ? "h-5 w-5" : "h-6 w-6"} text-primary`} />
        </div>
        <div className="w-full min-w-0 text-center">
          <p className={`${compact ? "text-xs" : "text-sm"} font-medium text-dark dark:text-white mb-1`}>
            Drop files here
          </p>
          <p className="text-xs text-dark-5 dark:text-dark-6">
            or{" "}
            <label className="text-primary cursor-pointer hover:underline font-medium">
              browse files
              <input
                type="file"
                accept={accept}
                multiple
                onChange={handleFileChange}
                className="hidden"
              />
            </label>
          </p>
          <p className="mt-2 truncate text-xs text-dark-5 dark:text-dark-6">
            {supportedFormatsLabel}
          </p>
        </div>
      </div>
    </div>
  );
}
