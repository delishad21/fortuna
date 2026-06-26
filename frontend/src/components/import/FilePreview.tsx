"use client";

import { useState, useEffect } from "react";
import { FileText, Table } from "lucide-react";

interface FilePreviewProps {
  file: File | null;
}

export function FilePreview({ file }: FilePreviewProps) {
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [csvData, setCsvData] = useState<string[][] | null>(null);

  useEffect(() => {
    if (!file) {
      setFileUrl(null);
      setCsvData(null);
      return;
    }

    const url = URL.createObjectURL(file);
    setFileUrl(url);

    // If it's a CSV, parse it for preview
    if (file.name.toLowerCase().endsWith(".csv")) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        const rows = text.split("\n").map((row) => {
          // Simple CSV parsing (doesn't handle quoted commas)
          return row.split(",").map((cell) => cell.trim());
        });
        // Only show first 20 rows for preview
        setCsvData(rows.slice(0, 20));
      };
      reader.readAsText(file);
    }

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  if (!file) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 mb-4">
          <FileText className="h-4 w-4 text-primary" />
          <h4 className="font-sans text-sm font-semibold text-dark dark:text-white uppercase tracking-wide">
            File Preview
          </h4>
        </div>
        <div className="flex-1 flex items-center justify-center rounded-lg border-2 border-dashed border-stroke dark:border-dark-3 min-h-[500px]">
          <div className="text-center">
            <FileText className="h-12 w-12 text-dark-5 dark:text-dark-6 mx-auto mb-3" />
            <p className="text-sm text-dark-5 dark:text-dark-6">
              File preview will appear here
            </p>
          </div>
        </div>
      </div>
    );
  }

  const isPDF = file.name.toLowerCase().endsWith(".pdf");
  const isCSV = file.name.toLowerCase().endsWith(".csv");

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 mb-4">
        {isPDF ? (
          <FileText className="h-4 w-4 text-primary" />
        ) : (
          <Table className="h-4 w-4 text-primary" />
        )}
        <h4 className="font-sans text-sm font-semibold text-dark dark:text-white uppercase tracking-wide">
          File Preview
        </h4>
      </div>

      <div className="flex-1 bg-white dark:bg-dark-2 rounded-lg border border-stroke dark:border-dark-3 overflow-hidden min-h-[500px]">
        {isPDF && fileUrl && (
          <iframe src={fileUrl} className="w-full h-full" title="PDF Preview" />
        )}

        {isCSV && csvData && (
          <div className="overflow-auto h-full">
            <table className="w-full text-sm">
              <tbody>
                {csvData.map((row, rowIndex) => (
                  <tr
                    key={rowIndex}
                    className={
                      rowIndex === 0
                        ? "bg-gray-1 dark:bg-dark-3 font-medium"
                        : "hover:bg-gray-1/50 dark:hover:bg-dark-3/50"
                    }
                  >
                    {row.map((cell, cellIndex) => (
                      <td
                        key={cellIndex}
                        className="px-4 py-2 border-b border-stroke dark:border-dark-3 text-dark dark:text-white"
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {csvData.length >= 20 && (
              <div className="p-3 text-center text-xs text-dark-5 dark:text-dark-6 bg-gray-1/30 dark:bg-dark-3/30">
                Showing first 20 rows
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
