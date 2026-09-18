import { AsyncLocalStorage } from "node:async_hooks";
import type { Session } from "next-auth";

// Only the authenticated mobile route can establish this request-local context.
export const mobileSessionContext = new AsyncLocalStorage<Session>();
