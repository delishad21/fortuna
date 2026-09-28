# Fortuna chat for web and mobile

Status: approved for implementation planning on 2026-09-28; no product implementation yet.

## Outcome and agreed scope

Each Fortuna login can connect its own Codex account or supply an OpenRouter API key. Web and mobile share conversations, uploaded statements, progress, and pending approvals. The assistant answers financial questions, processes statements into staged imports, proposes labels, and develops parsers using Fortuna's existing sandbox workflow.

The user selected option A: the assistant may also propose edits to committed transactions, including categories, reimbursement allocations, and other fields editable in the existing transaction interface. It must show the exact changes and receive confirmation before applying them.

Defaults presented in the conversation: settings belong to a Fortuna user rather than an individual bank account; jobs continue after the app closes; no silent model/provider fallback; committing imports, activating parsers, and retaining fixtures require confirmation. No APK build is required.

## Architecture and alternatives

Use a shared chat domain in the data service, a separate durable worker process from the same service package, and provider adapters. Next.js authenticates web/mobile requests and proxies them to this domain. Both clients render the same persisted events and approval records. This keeps orchestration close to the existing transaction/import services without tying jobs to an HTTP request.

Alternatives considered: running the entire conversation inside a Next.js request is simpler but makes long parser jobs and reconnects fragile; creating a wholly independent chat service adds deployment and duplicated financial authorization logic. The shared domain plus worker is the recommended balance for the current Compose deployment.

Existing integration points:

- `frontend/src/lib/auth.ts`: web identity; `frontend/src/lib/mobile/session.ts`: mobile identity.
- `services/data-service/src/modules/auth/auth.middleware.ts`: trusted service identity assertion.
- `services/data-service/src/modules/imports/hermes-workflow.service.ts`: statement registration, parsing, rules, staged proposals, validation, and commit.
- Existing parser factory/runtime services: candidate testing, approval, activation, and rollback.
- `services/finance-mcp/src/mcp.ts`: tool semantics to reuse, not a public mobile endpoint. Its current container identity must not become the chat user's identity.
- `mobile/App.tsx` and existing import/transaction screens: navigation and review destinations.

## Providers and credentials

Codex uses its supported App Server managed sign-in, preferring device-code login for a headless home server. Bind every login attempt to its Fortuna user. Maintain a separate credential directory and runtime per user, launched lazily with an idle timeout; never reuse the host operator's Codex session. Disconnect stops that user's runtime and removes its credentials. Credential volumes are private to the worker, excluded from logs and source control, and included only in encrypted backups.

Request `gpt-6-luna` with `max` reasoning effort after checking the connected account's returned model catalog. If unavailable, display an actionable error; do not choose a replacement. Expose only the Fortuna tool adapter to the runtime; disable general shell, filesystem, browser, and unrelated MCP capabilities. Generated parser code executes only in the existing parser sandbox.

OpenRouter uses `openai/gpt-6-luna-pro`. Store keys encrypted with authenticated encryption using an operator-managed server secret and a key version; settings responses expose only connection status and a masked key hint. Validate the provider's tool support and account access with a connection test. Never send either provider's credentials to Expo or browser clients.

Provider adapters normalize streamed text, tool requests/results, cancellation, usage, and errors. A run records its provider/model configuration at creation. Provider switching is explicit; shared conversation history remains in Fortuna and is supplied to the newly selected provider as bounded context. Explain that switching providers sends the continued conversation context to that provider. No automatic provider failover.

References verified during feasibility review:
- https://learn.chatgpt.com/docs/app-server
- https://developers.openai.com/api/docs/models/gpt-6-luna
- https://openrouter.ai/openai/gpt-6-luna-pro

## Storage and execution

Add provider connections, conversations, messages, attachments, runs, ordered run events, and action proposals. All records have a Fortuna user owner; relations must enforce matching ownership. Maintain both Prisma schemas and put migrations in the data service's existing migration history.

Runs move through queued, running, awaiting confirmation, completed, failed, or cancelled. Use Postgres-backed claims, leases, heartbeats, and bounded retries, with one active run per conversation. Clients send an idempotency key when submitting a message. Persist tool invocation IDs and outcomes; never blindly replay a consequential action after a crash. Recover from the recorded action result or mark the outcome for reconciliation.

Persist progress and final messages independently of the client's connection. Web can stream events; mobile can poll with an event cursor and reconnect on foreground. Start with polling on both if it offers more reliable Expo behavior. A disconnected phone does not cancel a run. Provide an explicit stop action; stopping prevents new tools but cannot undo an already committed database transaction.

Use finite model-turn, tool-call, execution-time, upload-size, and per-user concurrency limits. Show quota/auth/provider errors without losing the conversation or drafts. Retain conversations until user deletion; raw attachments use the existing statement retention policy, displayed in the upload flow. Deleting chat must not delete committed transactions or staged imports. Fixture retention remains a separate explicit choice.

## Authentication and tool boundaries

Use shared `/api/chat` routes for conversations, messages, runs/events, files, settings, provider login, and approvals. Support the existing web session and mobile bearer session. Cookie-authenticated mutations require same-origin/CSRF protection; reject ambiguous credentials. Forward only a server-derived identity over the existing internal authentication mechanism.

Tools do not accept a user ID, arbitrary URL, SQL, filesystem path, or arbitrary server operation name. Validate all inputs and all referenced categories, transactions, staged rows, bank accounts, files, and parsers against the authenticated user. Call scoped domain services rather than exposing the full mobile operation allowlist or legacy transaction HTTP routes to the model.

Tool groups:

1. Read transactions and database-calculated analytics with explicit date range, currency, account filters, and treatment of internal transfers/reimbursements. Do not combine currencies without an existing supported conversion basis. Responses link to relevant records and explain the applied filters.
2. Upload and inspect statements, select parsers, create/update staged drafts, and propose labels. Preserve fixed-rule precedence, row versions, confidence/rationale, review requirements, duplicate checking, and staged reimbursement behavior.
3. Inspect parser fixtures, author candidates, and run sandbox tests. Fixture retention, approval, activation, and rollback use user-confirmed actions; tests and authoring may proceed without repeated confirmation.
4. Propose committed-transaction edits, category/account creation, import-rule changes, and import commits. Existing data deletion is not added to chat in this scope.

Statement contents and tool results are untrusted data. Tool results are bounded and redact unnecessary sensitive identifiers. Audit tool execution and approvals without logging credentials or entire raw statements.

## Confirmation protocol

An action proposal stores its owner, conversation, exact target IDs, normalized arguments, before/after values, relevant versions or state hashes, and an expiry. The model can create proposals but cannot mark them approved. The human confirms or rejects through an authenticated UI endpoint.

Use a concrete preview with transaction dates, descriptions, amounts, changed fields, and reimbursement targets. Bulk changes freeze the selected IDs; never approve an open-ended filter that could later match additional rows. Approvals expire after 24 hours or immediately when any relevant state changes. Revalidate ownership, field constraints, linked-record state, and approval validity immediately before execution.

Where operations are contained in Postgres, consume the approval and apply changes atomically using locking/version checks. Parser activation uses a persisted, idempotent action state and existing version-aware activation workflow. Repeat taps return the original result. A stale proposal returns a fresh preview requiring a new confirmation.

Import commits rerun existing validation, including duplicates within/across selected drafts and the saved ledger. Duplicate override is a separate explicit choice attached to the reviewed findings. High-impact blockers identify the actual source row and link directly to its review. Multi-draft results report each committed or failed draft honestly; partial success is never presented as complete success.

## Web and mobile experience

Web adds Chat to primary navigation, a conversation list, attachment controls, progress messages, financial result cards, and approval previews. It uses Fortuna's existing theme, typography, and components. Settings gains an AI connection section with provider selection, connect/test/disconnect, model status, and reconnect guidance.

Mobile adds Chat as a bottom tab and moves Settings to a header/profile entry, preserving five tabs. Use a keyboard-aware composer, native document picker, expandable result cards, and full-screen approval sheets for longer diffs. Keep confirmation buttons distinct from sending messages. Reuse the existing transaction detail and staged import review screens through navigation links.

Show connection-required, loading, empty, offline, reconnecting, rejected, stale-approval, and failed-run states. Keep unsent text on transient network failure. Returning to chat resumes persisted progress. Opening a draft from chat displays the same draft as the Imports tab.

## Delivery and validation

Implement in dependent increments: storage/auth and provider connection lifecycle; persistent conversations/worker and read-only tools; statement staging and review links; confirmed ledger edits; parser authoring/testing and confirmed activation; web/mobile integration and deployment validation. These increments collectively deliver the agreed scope, not a reduced read-only release.

First validate Codex managed login, model discovery, restricted tool execution, refresh, and isolation using test users. Do not present Codex as supported until this works with the pinned runtime version. OpenRouter also needs a real tool-call smoke test with a supplied test credential; provider mocks alone do not establish live compatibility.

Required tests cover cross-user access (including linked IDs and credentials), model-forged approvals, stale/replayed/concurrent approvals, partial failures, restart recovery, duplicate commit prevention, fixed rules, reimbursement targets, exact analytics, reconnects, and provider errors. Test parser activation/fixture approvals through the existing sandbox. Use synthetic statements and test accounts for mutation tests.

Run data-service tests/typecheck/build, frontend tests/build, and mobile tests/typecheck. Follow `mobile/AGENTS.md` by reading Expo SDK 57 documentation before mobile implementation. Exercise both interfaces against the same conversation and verify Expo Go on the existing configured server connection. Deploy additive migrations with a backup, preserve existing staged imports, and verify health/auth before enabling chat. Do not compile an APK.

Current unrelated working changes in `frontend/tsconfig.json`, `mobile/src/imports.tsx`, and `mobile/tests/mobile.spec.ts` must be preserved. Implementation should use an isolated worktree and reconcile only intentional overlaps.
