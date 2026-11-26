"use client";

import { useRef, useState, type ReactNode } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/** A File's bytes as base64, without the data: prefix. */
export const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });

/**
 * Upload, replace or remove one image. Saves straight away through the given
 * callbacks; the server checks the bytes, so its error message is shown as is.
 */
export function ImageUploadField({
  imageUrl,
  fallback,
  canRemove = Boolean(imageUrl),
  onUpload,
  onRemove,
  size = 48,
}: {
  imageUrl: string | null | undefined;
  /** Shown when there is no image, e.g. the category icon. */
  fallback?: ReactNode;
  /** False when the shown image is inherited (a card showing its account's). */
  canRemove?: boolean;
  onUpload: (base64: string) => Promise<void>;
  onRemove: () => Promise<void>;
  size?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the image");
    } finally {
      setBusy(false);
    }
  };

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type)) {
      setError("Use a PNG, JPEG, GIF or WebP image.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("Images can be up to 5 MB.");
      return;
    }
    void run(async () => onUpload(await fileToBase64(file)));
  };

  return (
    <div>
      <div className="flex items-center gap-3">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt=""
            className="shrink-0 rounded-full border border-stroke object-cover dark:border-dark-3"
            style={{ width: size, height: size }}
          />
        ) : (
          fallback
        )}
        <input
          ref={inputRef}
          type="file"
          accept={IMAGE_TYPES.join(",")}
          className="hidden"
          onChange={(e) => {
            handleFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          isLoading={busy}
          leftIcon={<ImagePlus className="h-4 w-4" />}
          onClick={() => inputRef.current?.click()}
        >
          {canRemove ? "Replace" : "Upload"}
        </Button>
        {canRemove && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            leftIcon={<Trash2 className="h-4 w-4" />}
            onClick={() => void run(onRemove)}
          >
            Remove
          </Button>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-red">{error}</p>}
    </div>
  );
}
