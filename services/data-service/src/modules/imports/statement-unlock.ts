/**
 * Password-protected statement PDFs are decrypted once, at upload, so the file
 * fortuna stores and parses later needs no password. The password goes to the
 * file parser in memory and is never stored, logged or returned.
 */

export type StatementUpload = {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
};

export const PDF_PASSWORD_REQUIRED = "pdf_password_required";
export const PDF_PASSWORD_INCORRECT = "pdf_password_incorrect";

const fail = (status: number, message: string, code?: string): never => {
  throw Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
};

export function isPdf(file: Pick<StatementUpload, "mimetype" | "buffer" | "originalname">) {
  return (
    file.mimetype === "application/pdf" ||
    file.buffer.subarray(0, 1024).includes("%PDF-") ||
    file.originalname.toLowerCase().endsWith(".pdf")
  );
}

/** Returns the upload as it should be stored: decrypted when it was locked. */
export async function unlockStatement(file: StatementUpload, password?: string): Promise<StatementUpload> {
  // Only an encrypted PDF has an /Encrypt entry; anything else is stored as uploaded.
  if (!isPdf(file) || (!password && !file.buffer.includes("/Encrypt"))) return file;

  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  if (!internalToken) throw new Error("INTERNAL_SERVICE_TOKEN is required for parser calls");
  const form = new FormData();
  form.append("file", new Blob([file.buffer], { type: "application/pdf" }), "statement.pdf");
  if (password) form.append("password", password);
  const response = await fetch(
    new URL("/pdf/unlock", process.env.PARSER_SERVICE_URL || "http://file-parser:4000"),
    { method: "POST", body: form, headers: { "X-Internal-Service-Token": internalToken } },
  ).catch(() => fail(502, "The file parser is unavailable, so the PDF couldn't be checked for a password"));
  if (!response.ok) return fail(502, `The file parser couldn't open the PDF (${response.status})`);

  if (response.headers.get("x-pdf-status") === "unlocked") {
    const buffer = Buffer.from(await response.arrayBuffer());
    return { ...file, mimetype: "application/pdf", buffer, size: buffer.length };
  }
  const { status } = (await response.json()) as { status?: string };
  if (status === "password_required")
    return fail(422, "This PDF is password-protected. Upload it again with its password.", PDF_PASSWORD_REQUIRED);
  if (status === "password_incorrect")
    return fail(422, "That password doesn't open this PDF. Upload it again with the right password.", PDF_PASSWORD_INCORRECT);
  return file;
}
