# Fortuna Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for inline execution, or superpowers:subagent-driven-development if the user chooses delegated execution. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the same account-specific, provider-powered financial assistant in Fortuna web and mobile, including confirmed changes to saved transactions.

**Architecture:** Next.js authenticates both clients and proxies a shared chat API to the data service. A separate worker runs durable Postgres-backed jobs with Codex and OpenRouter adapters; financial tools call scoped domain services. Human approval is persisted and enforced outside the model.

**Tech Stack:** Existing TypeScript, Next.js, Express, Prisma 5.15/Postgres, Expo SDK 57, React Navigation, Node test runner, Playwright, Docker Compose; Codex App Server and OpenRouter HTTP API.

**Spec:** [Approved design](../specs/2026-09-28-fortuna-chat-design.md). Read it alongside this plan. User approved confirmed ledger edits and advanced to implementation planning on 2026-09-28.

## Global Constraints

- Settings belong to a Fortuna user rather than an individual bank account.
- No silent model/provider fallback.
- Request `gpt-6-luna` with `max` reasoning effort after checking the connected account's returned model catalog.
- OpenRouter uses `openai/gpt-6-luna-pro`.
- The model can create proposals but cannot mark them approved.
- Approvals expire after 24 hours or immediately when any relevant state changes.
- Existing data deletion is not added to chat in this scope.
- No APK build is required.
- Follow `mobile/AGENTS.md` by reading Expo SDK 57 documentation before mobile implementation.
- Preserve unrelated working changes in `frontend/tsconfig.json`, `mobile/src/imports.tsx`, and `mobile/tests/mobile.spec.ts`.
- Do not run financial mutation tests against the user's production transactions or statements.

## Review Focus

1. Two phones approve the same change concurrently: one mutation and the same recorded outcome (Task 7).
2. A saved transaction's reimbursement target changes between preview and approval: invalidate the whole preview, including backlink effects (Task 8).
3. A worker crashes after a financial write but before reporting success: recover its durable outcome without replaying the write (Tasks 5, 8, 9).
4. Switching Fortuna login or server on a phone must clear the previous user's cached messages and unsent text (Task 12).
5. A file expires while parser development is pending: explain the unavailable attachment, preserve drafts, and request another upload without resurrecting the expired file (Tasks 9, 10).

## Execution conventions and file map

Use an isolated worktree created via the using-git-worktrees skill. Do not stash, revert, or copy unrelated edits. There is no root npm workspace. Use Node >=22.13.0 for mobile commands. Commit only the files belonging to each completed task.

Backend files below are relative to `services/data-service/src/modules/chat/` unless a full path is given. Keep provider transport, queue persistence, approvals, and financial tools in separate modules. Existing large import/parser/transaction files get only necessary extraction or transaction-context changes.

New backend files: `contracts.ts`, `chat.repository.ts`, `chat.service.ts`, `chat.controller.ts`, `credentials.ts`, `providers/provider.ts`, `providers/codex.ts`, `providers/codex-runtime.ts`, `providers/openrouter.ts`, `connections.service.ts`, `worker.ts`, `run.repository.ts`, `runner.ts`, `approvals.service.ts`, `tools/registry.ts`, `tools/read.ts`, `tools/transactions.ts`, `tools/imports.ts`, `tools/parsers.ts`; colocated `*.test.ts` tests.

New frontend files: `src/lib/chat/{auth,proxy,client,contracts}.ts`, `src/app/api/chat/[...path]/route.ts`, `src/app/(dashboard)/chat/page.tsx`, `src/components/chat/{ChatClient,ConversationList,MessageList,Composer,ActionPreview,ConnectionPanel}.tsx` and focused tests. Frontend owns public transport DTOs, not worker/provider credentials. Create shared JSON contract fixtures in `services/data-service/src/modules/chat/fixtures/contracts.json`; frontend/mobile wire tests consume these same fixtures to detect DTO drift without introducing a root npm workspace.

New mobile files: `src/chat/{api,types,state}.ts`, `src/chat/{ChatScreen,ConversationScreen,ApprovalScreen,ConnectionScreen,MessageCard}.tsx`, `tests/chat.spec.ts`. Reuse `src/ui.tsx` and existing API/session state.

### Task 1: Establish contracts, owned persistence, and an isolated database test harness

**Files:** Create `contracts.ts`, `contracts.test.ts`, `chat.repository.ts`, `chat.repository.test.ts`, `test-harness.ts`; modify both Prisma schemas; create `services/data-service/prisma/migrations/20260928000100_chat_core/migration.sql`; add `services/data-service/docker-compose.chat-test.yml`.

**Interfaces:** `ChatContext = { userId: string; runId: string; conversationId: string }`; `ProviderChoice = 'codex' | 'openrouter'`; `RunStatus = 'queued' | 'running' | 'awaiting_confirmation' | 'completed' | 'failed' | 'cancelled'`. `createConversation(userId: string): Promise<{id: string}>`; `getConversation(userId: string, id: string): Promise<Conversation|null>`. Export `withChatDb(fn: (db: PrismaClient) => Promise<void>): Promise<void>` from the test harness: require `CHAT_TEST_DATABASE_URL`, refuse the normal `DATABASE_URL`, seed synthetic users, and clean only its isolated database.

- [ ] Add failing tests for strict tool input (reject `userId`/`confirmed`), cross-user reads, and foreign-owned conversation/run/attachment references. A representative schema test:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { submitMessageSchema } from './contracts';
test('client cannot select another owner', () => {
  assert.equal(submitMessageSchema.safeParse({
    text: 'How much did I spend?', idempotencyKey: 'msg-001',
    attachmentIds: [], userId: 'someone-else'
  }).success, false);
});
```

- [ ] Run from `services/data-service`: `npx tsx --test src/modules/chat/contracts.test.ts`; confirm the new contract is missing before implementing it.
- [ ] Define strict Zod schemas and DTOs. Persist `ChatConnection`, `ChatConversation`, `ChatMessage`, `ChatAttachment`, `ChatRun`, `ChatRunEvent`, `ChatToolInvocation`, and `ChatActionProposal`. Use user-owned composite foreign keys, unique `(userId, conversationId, idempotencyKey)`, unique `(runId, sequence)`, and a partial unique SQL index for active runs per conversation. Messages store structured text/result/proposal blocks; tool outcomes store stable invocation IDs. Use database-generated timestamps and UUIDs. Add connection generation/version and proposal expiry/state fields.
- [ ] Add a disposable Postgres test Compose service with a tmpfs data directory and loopback port 55432. Apply migrations only to this database. Implement the harness, seed two synthetic users, and prove composite foreign keys reject mismatched owners. No silent skipping: integration tests fail clearly without the test database.
- [ ] Generate both Prisma clients; run contract/repository tests, service typecheck, and schema validation for both schemas. Commit as `feat(chat): add owned conversation and run storage`.

### Task 2: Add authenticated shared chat transport

**Files:** Create `chat.service.ts`, `chat.controller.ts`, `chat.controller.test.ts`; modify `services/data-service/src/index.ts`; create frontend `src/lib/chat/auth.ts`, `proxy.ts`, their tests, and `src/app/api/chat/[...path]/route.ts`.

**Interfaces:** `resolveChatIdentity(request: Request): Promise<{userId: string}>`; `forwardChatRequest(request: Request, userId: string, path: string[]): Promise<Response>`. Service `ChatService` exposes create/list/get/delete conversation and submit-message methods with `userId` as a separate trusted argument.

- [ ] Add tests for expired mobile tokens, absent web sessions, cross-origin cookie mutations, simultaneous cookie/bearer identities, forged internal identity headers, and cross-user conversation IDs. Verify DELETE conversation preserves referenced statements, drafts, and transactions.
- [ ] Run `npx tsx --test src/lib/chat/auth.test.ts src/lib/chat/proxy.test.ts` in frontend and the controller test in data-service; confirm failures before adding routes.
- [ ] Implement an allowlisted route dispatcher rather than an arbitrary internal proxy:

```ts
const routes = [
  ['GET', /^conversations$/], ['POST', /^conversations$/],
  ['GET', /^conversations\/[^/]+$/], ['DELETE', /^conversations\/[^/]+$/],
  ['POST', /^conversations\/[^/]+\/messages$/],
  ['GET', /^runs\/[^/]+\/events$/], ['POST', /^runs\/[^/]+\/cancel$/],
  ['POST', /^files$/], ['GET', /^settings$/], ['PUT', /^settings$/],
  ['POST', /^connections\/(codex|openrouter)\/(start|test|disconnect)$/],
  ['GET', /^connections\/codex\/login\/[^/]+$/],
  ['POST', /^proposals\/[^/]+\/(approve|reject)$/]
] as const;
```

- [ ] Derive identity from existing web/mobile authentication; never trust incoming identity assertion headers. For cookie mutations compare Origin against the configured Fortuna origin and reject absent/mismatched origins. Disable caching, bound JSON bodies to 256 KiB, and reserve a bounded multipart upload path. Internal routes require the trusted service credential plus asserted owner. Return 401 for unauthenticated requests, 404 for foreign-owned records, 409 for conflicts, and 413 for oversized requests.
- [ ] Run both focused suites and frontend/service typechecks. Commit as `feat(chat): authenticate shared web and mobile routes`.

### Task 3: Prove Codex connection and restricted runtime

**Files:** Create `providers/provider.ts`, `providers/codex-runtime.ts`, `providers/codex.ts`, `providers/codex.test.ts`, `connections.service.ts`, `connections.service.test.ts`; add `services/data-service/src/scripts/chat-provider-smoke.ts`; create `services/data-service/Dockerfile.chat-worker`.

**Interfaces:** `ChatProvider.testConnection(userId: string): Promise<ConnectionStatus>` and `ChatProvider.run(input: ProviderInput, signal: AbortSignal): AsyncIterable<ProviderEvent>`. `ProviderInput` contains model, reasoning effort, bounded message blocks, and tool definitions; `ProviderEvent` is `text_delta`, `tool_call` (id/name/arguments), `usage`, or `completed`. `CodexRuntime.startLogin(userId)`, `loginStatus(userId, loginId)`, `getClient(userId)`, and `disconnect(userId)` always use server-owned user IDs. `ConnectionStatus` reports connected, modelAvailable, needsReconnect, and a sanitized error.

- [ ] Read current official App Server documentation and pin the tested CLI version in the worker image. Verify protocol behavior before writing transport code; do not infer app-server RPC names from Responses API names.
- [ ] Add protocol fixture tests for two simultaneous owners, unsupported `max`, login cancellation/expiry, token refresh failure, disconnection during a run, fragmented JSON-RPC frames, and forbidden built-in tools. Core model assertion:

```ts
assert.equal(selected.model, 'gpt-6-luna');
assert.equal(selected.reasoningEffort, 'max');
assert.equal(selected.fallback, undefined);
```

- [ ] Run `npx tsx --test src/modules/chat/providers/codex.test.ts src/modules/chat/connections.service.test.ts`; confirm tests fail against the absent adapter.
- [ ] Implement managed device-code login bound to user/login ID and generation. Launch each process with a private generated home/config directory and minimal environment; remove inherited host credentials/MCP configuration. Directory permissions are 0700 and credential files 0600. Restrict available tools at runtime configuration/protocol boundaries; prompt instructions alone do not count. Validate model catalog and supported effort; cap idle processes and close them after ten minutes idle. Pin an image base compatible with the tested CLI binary.
- [ ] In a synthetic test account, run `npx tsx src/scripts/chat-provider-smoke.ts codex`. Complete the supported device login interactively, exercise model discovery, one allowed synthetic tool, a rejected shell/filesystem request, disconnect, and a second isolated identity. Refresh testing must cover actual expiry/refresh behavior where observable, with protocol tests for the remaining failure paths. Output redacted capability results only.
- [ ] Ensure the runtime cannot reach another user's credential directory or receive another user's environment/context. Private directories with the same OS UID alone are not sufficient isolation against a process with filesystem tools: prove those tools are unavailable and the RPC bridge cannot request process/file operations; otherwise use an OS-isolated per-user runtime before shipping this provider.
- [ ] If runtime tool restrictions or managed authentication cannot be demonstrated, stop Codex delivery and report the exact failed capability; do not expose an unrestricted runtime. Continue independent OpenRouter/backend work while resolving it. Commit the tested adapter as `feat(chat): isolate Codex account connections`.

### Task 4: Add encrypted OpenRouter connections

**Files:** Create `credentials.ts`, `credentials.test.ts`, `providers/openrouter.ts`, `providers/openrouter.test.ts`; extend `connections.service.ts`, controller settings handlers, and provider smoke script; modify `.env.example` with secret variable names only.

**Interfaces:** `sealCredential(userId: string, plaintext: string): EncryptedSecret`; `openCredential(userId: string, secret: EncryptedSecret): string`; `EncryptedSecret = { keyVersion: string; iv: string; ciphertext: string; tag: string }`. Implement the Task 3 provider interface. `ConnectionService.update(userId, choice, key?)`, `test(userId)`, and `disconnect(userId, provider)` never return a plaintext secret.

- [ ] Add failing tests for wrong owner, tampering, missing encryption key, disconnect/key rotation during a run, fragmented streamed tool arguments, 401, 429 with Retry-After, 5xx, malformed arguments, and cancellation. Representative crypto check:

```ts
const secret = sealCredential('alice', 'test-key');
assert.equal(openCredential('alice', secret), 'test-key');
assert.throws(() => openCredential('bob', secret));
assert.equal(JSON.stringify(secret).includes('test-key'), false);
```

- [ ] Run credential/provider tests. Implement AES-256-GCM with fresh 12-byte nonces, user/provider/key-version authenticated data, and an operator-provided 32-byte key. Fail closed if encryption configuration is absent. Persist only encrypted data and a masked suffix.
- [ ] Use the documented OpenRouter tool-capable endpoint with `openai/gpt-6-luna-pro`, bounded response parsing, AbortSignal, and provider error normalization. Do not copy unsupported request fields from Codex. Resolve server-owned conversation context under a token budget, retaining outstanding tool call/result pairs; reject an oversized single message rather than silently truncating it.
- [ ] Run an opt-in live synthetic tool call via `npx tsx src/scripts/chat-provider-smoke.ts openrouter` using a securely supplied test key. Never request keys in chat or store them in the repository. Record actual model and tool result without credentials. Commit as `feat(chat): support encrypted OpenRouter credentials`.

### Task 5: Implement durable runs and event recovery

**Files:** Create `run.repository.ts`, `runner.ts`, `worker.ts`, `runner.test.ts`; extend `chat.service.ts`, controller event/cancel handlers, and `services/data-service/package.json` with `chat:worker`.

**Interfaces:** `enqueueRun(userId, conversationId, message): Promise<{runId: string}>`; `claimRun(workerId: string): Promise<ClaimedRun|null>`; `appendEvent(runId, leaseToken, event): Promise<number>`; `listEvents(userId, runId, after: number): Promise<ChatEvent[]>`; `cancelRun(userId, runId): Promise<void>`. `executeRun(run: ClaimedRun, provider: ChatProvider, signal: AbortSignal): Promise<void>`. A `ClaimedRun` includes owner/context, lease token, provider snapshot, and connection generation.

- [ ] Write DB-backed tests that launch two claimers and receive one winner, submit the same message twice, drop a client connection, expire a lease, crash after tool-result persistence, and cancel while waiting for provider output.
- [ ] Run `npx tsx --test src/modules/chat/runner.test.ts`; confirm failures. Implement atomic claims with `FOR UPDATE SKIP LOCKED`, 60-second leases, 15-second heartbeats, and a fencing token checked on every write. Use ordered, persisted events; duplicate cursor delivery must be harmless.
- [ ] Add limits and test each boundary:

```ts
export const CHAT_LIMITS = {
  activeRunsPerUser: 1, modelTurns: 12, toolCalls: 40,
  runMilliseconds: 15 * 60_000, eventsPerPage: 100,
  messageCharacters: 16_000, attachmentCount: 5,
  fileBytes: 25 * 1024 * 1024, bulkTargets: 100
} as const;
```

- [ ] Persist every invocation before execution and its result before the next provider turn. Retry read-only provider failures at most twice with bounded backoff; never replay unknown-outcome writes. Waiting approvals release the worker lease and runtime capacity; explicit approval queues a new continuation. Parser jobs persist external job IDs and can be polled across run resumptions. Reconcile abandoned jobs on worker startup.
- [ ] Verify replay after restart, stale worker writes rejected, and conversation deletion cancels pending runs without deleting finance records. Commit as `feat(chat): persist and recover background conversations`.

### Task 6: Add scoped read tools and exact financial summaries

**Files:** Create `tools/registry.ts`, `tools/read.ts`, `tools/read.test.ts`; extract reusable calculations/querying into `services/data-service/src/modules/analytics/analytics.service.ts` from the existing controller as needed; modify that controller to use the extraction.

**Interfaces:** `executeChatTool(context: ChatContext, name: string, input: unknown): Promise<ToolResult>`; `ToolResult = { blocks: ResultBlock[] }`; blocks include text, transaction links, per-currency summary with filters, draft link, and proposal link. `getSpendingSummary(userId: string, filters: SummaryFilters): Promise<SummaryResult>`. `SummaryFilters` specifies dateFrom/dateTo, timezone, currency, account identifiers, category IDs, and internal/reimbursement inclusion. No raw SQL, arbitrary operation dispatch, or user IDs in tool arguments.

- [ ] Add tests with synthetic income, expenses, internal transfers, partial reimbursement, staged-target reimbursement, two currencies, and a transaction at the requested timezone's month boundary. Include malicious text in merchant names and foreign category/account IDs.
- [ ] Run `npx tsx --test src/modules/chat/tools/read.test.ts`. Implement strict tool schemas and service-side ownership checks. Reuse current effective-spend semantics while performing decimal money aggregation on the server; serialize decimal totals as strings rather than accumulating binary floating-point in the model.
- [ ] Limit transaction pages to 100 rows and summaries to explicit date ranges; return the interpreted filters, currency, count, and links. Refuse unprovided currency conversions. Example result:

```json
{"currency":"SGD","expense":"55.55","count":2,"filters":{"dateFrom":"2026-08-01","dateTo":"2026-09-01","includeInternal":false}}
```

- [ ] Register read tools for both providers, run existing analytics regression tests plus the new suite, and verify the same question has equivalent results through both adapters. Commit as `feat(chat): query scoped transactions and spending`.

### Task 7: Enforce human approval with concurrency protection

**Files:** Create `approvals.service.ts`, `approvals.test.ts`; extend controller proposal handlers and `tools/registry.ts`.

**Interfaces:** `proposeAction(context: ChatContext, action: ActionInput): Promise<ActionPreview>`; `decideAction(userId: string, proposalId: string, decision: 'approve'|'reject', duplicateOverride?: boolean): Promise<ActionOutcome>`. `ActionInput` is a discriminated union: edit_transactions, commit_drafts, create_category, create_account, update_import_rule, retain_fixture, approve_parser, activate_parser, rollback_parser. `ActionPreview` contains stable target IDs, before/after display values, state hash, expiry, warnings, and action type. `ActionOutcome` is applied, rejected, stale, failed, or reconciling with structured record links/results.

- [ ] Add a two-client concurrency test, a model-forged `confirmed: true` test, stale/expired proposal tests, foreign proposal tests, and approval after logout/reconnect. The integration assertion is:

```ts
const outcomes = await Promise.all([
  decideAction(aliceId, proposalId, 'approve'),
  decideAction(aliceId, proposalId, 'approve')
]);
assert.deepEqual(outcomes[0], outcomes[1]);
assert.equal(await countAppliedAuditEvents(proposalId), 1);
```

Here `countAppliedAuditEvents` is a local test helper querying the isolated DB's action audit by proposal ID; add it to `approvals.test.ts`.

- [ ] Run the failing suite. Implement normalized action arguments, exact targets, canonical state hash, 24-hour expiry, row locks, and single-consumption state transitions. Add an internal executor interface `executeApprovedAction(tx: Prisma.TransactionClient, proposal: StoredProposal): Promise<ActionOutcome>` for transaction-contained actions; the model registry must not export this or the decision endpoint.
- [ ] Audit proposer/run, confirming user, targets, before/after state, timestamps, and outcome. On stale state return a regenerated preview without applying it. Freeze bulk selections at proposal creation. Separate duplicate override from ordinary approval.
- [ ] Run DB-backed approval tests under concurrent requests and commit as `feat(chat): require versioned human approval for mutations`.

### Task 8: Connect approved edits to ledger services

**Files:** Create `tools/transactions.ts`, `tools/transactions.test.ts`; modify `services/data-service/src/modules/transactions/transactions.service.ts` and `transactions.repository.ts` to accept a transaction-scoped Prisma client for the edit path and all linked writes; extend approvals executor. Extract account/category/rule helpers only where required by these actions.

**Interfaces:** `proposeTransactionEdits(context, edits: Array<{id: string; patch: EditableTransactionPatch}>): Promise<ActionPreview>`. Derive `EditableTransactionPatch` from the existing editable transaction fields, with strict schemas excluding ownership, IDs, import provenance, and arbitrary metadata. Preserve `TransactionService.updateTransaction(id, userId, data)` for existing callers and add a scoped internal implementation accepting `Prisma.TransactionClient`.

- [ ] Add tests for category edits, amount changes, internal classification, reimbursement target changes, target capacity, staged targets, backlinks, foreign linked IDs, stale linked state, bulk rollback, and crash immediately after committed approval/application.
- [ ] Run the new suite and existing staged reimbursement tests. Refactor the necessary edit call chain so proposal consumption and every linked write use one transaction; no nested global-Prisma writes. Lock affected records in deterministic ID order and revalidate after locks.
- [ ] Populate previews with all consequential changes, including backlink/capacity effects, before approval. Execution must produce the approved effect set; if service normalization changes it, regenerate the preview instead. Example patch contract:

```ts
type TransactionEdit = {
  id: string;
  patch: { label?: string; categoryId?: string | null;
    description?: string; date?: string; amountIn?: string | null;
    amountOut?: string | null; currency?: string; accountIdentifier?: string;
    linkage?: TransactionLinkage | null };
};
```

Reuse/import `TransactionLinkage` from `services/data-service/src/modules/duplicates/duplicate-detector.ts`; validate decimal strings before mapping to the established service input. Include any additional field only when the existing editor actually exposes it.

- [ ] Implement confirmed category/account creation and import-rule changes through the same executor. No deletion tool. Run all transaction/approval tests, service typecheck/build, and commit as `feat(chat): apply confirmed ledger changes atomically`.

### Task 9: Upload, stage, label, and commit imports

**Files:** Create `tools/imports.ts`, `tools/imports.test.ts`; extend multipart controller/proxy handlers, `hermes-workflow.service.ts`, and `hermes-workflow.controller.ts` only where required; extend frontend chat DTOs.

**Interfaces:** `attachStatement(userId, conversationId, upload): Promise<{attachmentId: string; statementFileId: string; expiresAt: string}>`; tools accept attachment/draft/row IDs, never local paths. `proposeImportCommit(context, draftIds: string[]): Promise<ActionPreview>`. Use `HermesWorkflowService.prepareSelection` and `commitDraft` through a durable execution journal keyed by proposal/draft; capture stable batch IDs.

- [ ] Add synthetic-file tests for oversized/invalid files, foreign attachment IDs, repeated upload/staging, fixed PayLah rules, high-impact proposal blockers with row IDs, duplicates across drafts and saved ledger, staged reimbursement allocations, expired files, and partial multi-draft success.
- [ ] Run the new suite before implementation. Stream multipart uploads with a 25 MiB per-file limit and existing supported MIME/file-type validation. Register through the existing statement service; do not retain fixtures automatically. Return retention metadata and sanitized filenames. Cancelled/failed uploads remove temporary files.
- [ ] Use existing parsing and proposal methods so fixed-rule precedence and draft/row versions remain authoritative. Return source filename, source row, transaction summary, rationale, and direct review target for blockers. Do not mark a draft labelled solely because the provider call succeeded.
- [ ] At approved commit time rerun validation and bind duplicate override to a hash of the reviewed findings. If findings changed, return a new proposal. Make commit/batch linkage and per-draft journal outcome crash-recoverable; after restart inspect the existing committed draft and batch instead of importing it again. Report outcomes explicitly:

```json
{"draftResults":[{"draftId":"a","status":"committed","batchId":"batch-a"},{"draftId":"b","status":"needs_review","rowId":"row-b-4"}]}
```

- [ ] Run import/duplicate/fixed-rule/reimbursement regressions plus the new crash test. Commit as `feat(chat): stage and review statement imports`.

### Task 10: Add parser development with explicit fixture and activation approvals

**Files:** Create `tools/parsers.ts`, `tools/parsers.test.ts`; extract `services/data-service/src/modules/imports/parser-factory.service.ts` from its controller; modify parser factory controller to delegate; reuse `services/finance-mcp/src/parser-authoring.ts` guidance without importing its account-bound client.

**Interfaces:** `createParserWorkspace(userId, statementFileIds, approvedProposalId): Promise<Workspace>`; `saveAndTestCandidate(context, workspaceId, candidate): Promise<{candidateId: string; jobId: string}>`; `getCandidateTestResult(userId, jobId): Promise<TestResult>`; parser approval/activation/rollback executors consume Task 7 proposals tied to candidate source hash and expected active version.

- [ ] Add tests for no fixture consent, expired/deleted statement, foreign workspace, candidate source changed after tests, failed sandbox checks, repeat activation, changed active version, restart after activation, and malicious parser source attempting outbound access/file traversal.
- [ ] Run parser tests, then extract scoped service methods from the existing HTTP controller. Reuse current sandbox transport, queue IDs, source hashing, and auditing. Keep the existing MCP route behavior compatible.
- [ ] Require the retained-fixture proposal before workspace creation. Bind approval to passing test results and exact source hash; activation and rollback each require their own preview. Reconcile activation through expected/current version and persisted action ID before retrying.
- [ ] Expose clear progress blocks instead of raw infrastructure logs:

```json
{"type":"parser_progress","candidateId":"candidate-1","stage":"testing","message":"Checking parsed rows and statement totals."}
```

- [ ] Run focused integration tests through the parser sandbox using synthetic fixtures; confirm the Codex process never executes parser code itself. Commit as `feat(chat): develop parsers with explicit activation approval`.

### Task 11: Build web chat and connection settings

**Files:** Create the frontend files in the file map, `src/lib/chat/client.test.ts`, `src/components/chat/ActionPreview.test.ts`, and `tests/chat.spec.ts`; modify `src/components/Layouts/Sidebar.tsx` and `src/components/settings/SettingsClient.tsx`; add a frontend Playwright config/script if no browser harness exists.

**Interfaces:** `ChatClientApi` wraps the shared route list; `useConversation(conversationId)` provides persisted message blocks, current run, proposals, send, cancel, approve, reject, and cursor refresh. `ActionPreview` consumes the server DTO; it does not derive hidden mutation arguments from text.

- [ ] Read the impeccable skill and inspect existing layout/theme components. Add tests for ordered duplicate event delivery, preserving unsent text on failure, disabled repeated approval taps, stale preview replacement, provider switching disclosure, and inaccessible/expired attachments.
- [ ] Implement conversation list, composer, file picker, progress/results, review links, approval diffs, stop, and delete-conversation controls. Poll events every 1.5 seconds while visible/active, pause when hidden, and refetch on focus. Render messages as escaped text or sanitized Markdown without raw HTML. Use accessible labels and keyboard focus for approval dialogs.
- [ ] Implement settings with connect/test/disconnect, masked key input, device code/link, model availability, and reconnect states. Example browser expectation:

```ts
await page.getByRole('button', { name: 'Review changes' }).click();
await expect(page.getByRole('dialog')).toContainText('Before');
await expect(page.getByRole('dialog')).toContainText('After');
await page.getByRole('button', { name: 'Confirm changes', exact: true }).click();
await expect(page.getByText('Changes applied', { exact: true })).toBeVisible();
```

- [ ] Add browser tests for settings, spending, upload-to-draft navigation, confirmed ledger edit, and reload during a run. Use deterministic provider mocks against isolated data, then manually smoke test with a connected provider. Run `npm test`, browser suite, and `npm run build` in frontend. Commit as `feat(chat): add web conversations and approval previews`.

The frontend currently has no `tests/` browser directory. Create it along with `playwright.config.ts`, add `@playwright/test` as a dev dependency, and add `test:e2e: playwright test` to package scripts. Use a separately started frontend on port 3000 backed by the isolated test stack; run `npm run test:e2e -- tests/chat.spec.ts`. Do not point this suite at the home server.

### Task 12: Build phone chat and shared conversation navigation

**Files:** Create mobile files in the file map; modify `mobile/App.tsx`, `mobile/src/api.tsx`, `mobile/src/settings.tsx`; use existing import/transaction routes without overwriting pending import edits; create `mobile/tests/chat.spec.ts`.

**Interfaces:** `useChatApi()` obtains the currently configured Fortuna server and mobile session through `useApi`; it implements the Task 11 wire contracts. `chatCacheKey(server, userId)` partitions cache/drafts. Routes `Chat`, `ChatConversation`, `ChatApproval`, and `AIConnection` receive IDs only, not credentials or finance mutation payloads.

- [ ] Read https://docs.expo.dev/versions/v57.0.0/ and exact document-picker/file-system documentation. Add mobile browser tests for five bottom tabs, Settings still reachable, configured-domain requests, expired session, server/user switching, failed send, background/resume, approval details, and draft navigation.
- [ ] Implement keyboard-aware conversation UI with virtualized messages, composer, native document picker, expandable cards, and a full-screen approval sheet. Reuse Expo dependencies already installed; do not require a custom dev client. Move Settings into the header/profile entry while preserving all existing settings routes.
- [ ] Resume polling from the last persisted cursor on AppState foreground. Clear account-scoped cached data and unsent text on logout/server switch. Never put API keys or provider login tokens in persistent mobile storage. Keep mobile auth behavior consistent with the existing app.
- [ ] Add an event-reducer test scenario in the browser harness:

```ts
await page.getByRole('button', { name: 'Send message' }).click();
await page.reload();
await expect(page.getByText('Checking your statement', { exact: true })).toBeVisible();
await expect(page.getByRole('button', { name: 'Review staged import' })).toBeVisible();
```

- [ ] Run `npm run typecheck`, `npm run check`, and `npm run test:e2e -- tests/chat.spec.ts` in mobile with Expo web running. Then verify file picking, keyboard layout, background/resume, and login link on a physical phone in Expo Go; browser testing is not a substitute. Commit as `feat(chat): add Expo conversations and approval sheets`.

### Task 13: Deploy worker, verify both providers, and update Expo Go

**Files:** Modify `docker-compose.yml`, `docker-compose.dev.yml`, worker Dockerfile, `.env.example`; create `services/data-service/CHAT_OPERATIONS.md`. Leave `.github/workflows/android-apk.yml` untriggered.

**Interfaces:** Worker health reports live heartbeat and queue availability without secrets. Configuration: `CHAT_ENABLED`, `CHAT_ENCRYPTION_KEY_V1`, `CHAT_CODEX_ROOT`, `CHAT_WORKER_CONCURRENCY`; existing database/parser/internal service settings remain server-side. Default chat off until migrations/runtime checks succeed.

- [ ] Add Compose worker service using the pinned image, private credential volume, non-root UID, resource limits, dropped Linux capabilities, no Docker socket, and no host source/home mounts. Ensure shutdown releases leases safely. Permit only required internal services/provider egress according to runtime needs.
- [ ] Document exact credential bootstrap/rotation, device login, reconnect, disabled-provider behavior, worker recovery, backup and rollback procedures. Runtime credentials must stay out of normal logs and unencrypted backup exports. Use a new encryption key generated server-side; never print it into the transcript.
- [ ] Run final checks from each package:

```sh
# services/data-service (isolated test DB configured)
npm test
npm run typecheck
npm run build
# frontend
npm test
npm run build
# mobile (Expo web available for E2E)
npm run typecheck
npm run check
npm run test:e2e
```

- [ ] Run full two-user end-to-end checks: same conversation on web/mobile, each provider's synthetic tool call, cross-user rejection, upload/staging, fixed rules, duplicate review, high-impact row link, confirmed ledger edit, parser fixture consent/testing/activation, reconnect, and worker restart after a write. Record actual results and unresolved live-provider checks; do not claim completion with only mocked integrations.
- [ ] Inspect current home-server deployment before changing it; back up Postgres and record image tags plus staged-draft counts/statuses. Build/publish the necessary versioned images for the server architecture. Deploy using the existing Compose project name `fortuna`, additive migration first, and start the worker with chat initially disabled. Verify schema/runtime health and test-user flows, then enable chat. On failure disable chat and restore prior images without dropping new tables or finance data.
- [ ] Confirm existing staged draft counts/statuses are unchanged except intentional test-user records; verify hostname/auth and existing imports still work. Restart/update the existing Expo Go development session, verify its reachable address, and report that verified address. Do not build or dispatch an APK workflow.
- [ ] Commit deployment/documentation changes as `ops(chat): deploy worker and document provider connections`. Report the deployed revision, tests actually run, any provider login the user still must complete, and remaining limitations.

## Dependency order and completion definition

Execute 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13. Task 4 and independent backend work can proceed if a live Codex account is temporarily unavailable, but Codex functionality cannot be declared complete without Task 3's live verification. UI work consumes stable DTOs and approval behavior from earlier tasks.

Completion means both interfaces expose the full agreed scope, each user can use their own tested provider connection, consequential actions require valid human approval, financial regression tests pass, and deployment/Expo Go are verified. No provider key is required to begin implementation; live testing later needs the user to connect their own accounts through the implemented settings.

## Plan self-review

- Spec coverage: provider/account isolation (1–4), durable conversations (5), analytics (6), confirmations and ledger edits (7–8), statements/import safeguards (9), parser workflows (10), web/mobile UX (11–12), retention/recovery and deployment (5, 9–10, 13).
- Review-focus cases are assigned explicit tests in Tasks 5 and 7–12.
- All mutation executors depend on Task 7; no client or provider adapter is authorized to bypass it.
- No product code, dependencies, schema migration, or deployment is performed by writing this plan.
