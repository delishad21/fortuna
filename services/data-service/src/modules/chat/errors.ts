import { ChatError } from "./contracts";
/** Domain validation messages are safe; never expose unknown filesystem/provider internals. */
export function safeChatError(error: unknown): string | null {
  if (error instanceof ChatError) return error.message;
  if (
    error instanceof Error &&
    Number.isInteger((error as any).status) &&
    (error as any).status >= 400 &&
    (error as any).status < 500
  )
    return error.message;
  return null;
}
