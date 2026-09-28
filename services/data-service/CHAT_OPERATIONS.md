# Fortuna chat operations

Chat shares the web/mobile authentication boundary. The internal worker control port 4003 must not be published. Each Fortuna user has separate provider credentials and conversation ownership. Chat never uses the operator's Codex account.

## Configuration and first start

Set `CHAT_ENABLED=false` while applying the additive Prisma migration. Generate `CHAT_ENCRYPTION_KEY_V1` on the server using 32 cryptographically random bytes encoded as base64; put it in the mode-0600 deployment env file without printing it. Both data-service and chat-worker require the same key. The worker also needs the existing database, parser, internal service token, commit token secret, and statement storage settings. `CHAT_WORKER_CONCURRENCY` defaults to 2 (maximum 8). `CHAT_CODEX_ROOT` is the private named volume `/data/chat-codex`.

The production data service and worker run as UID/GID 1000. Before updating an older root-run deployment, change ownership of its **statement directory only** to 1000:1000, preserving modes 0700 on directories and 0600 on statement files. Do not change Postgres ownership. For development, configure the data-service to run as the same UID and initialize the statement volume accordingly; otherwise its root-created statements cannot be read by the worker.

Back up Postgres and record current image tags and staged-draft statuses before deployment. Use the existing Compose project name (`-p fortuna` on the home server). Apply migrations through data-service, then start the worker. Check `/health` from inside the worker container: it requires a recent successful database probe. Enable `CHAT_ENABLED=true` on data-service and worker after these checks. No APK build is needed.

## Connect a provider

Open Settings → AI Connection on web, or the Settings header button → AI connection on mobile. Codex uses the pinned `@openai/codex@0.155.0-alpha.16.3` app-server with managed device login. Open the official sign-in link and enter the displayed code. A successful sign-in is not sufficient: Test connection must also find `gpt-6-luna` with `max` reasoning. OpenRouter uses the account's own API key; Save API key then Test connection checks `openai/gpt-6-luna-pro` and tool support. No fallback model is selected.

Credentials never enter message history. OpenRouter keys are AES-256-GCM encrypted with per-user authenticated context and a key version; only the last four characters are returned to the UI. Codex credentials are stored in per-user hashed directories in the private volume, with no host home/source mounts. Do not export that volume into unencrypted backups or logs. Provider traffic necessarily includes the conversation and statement content requested by that user.

## Recovery, rotation, and rollback

Jobs use renewable leases and durable tool outcomes. A crashed worker's expired lease can be reclaimed up to three times. A completed write is not blindly replayed. An unresolved interrupted tool write asks the user to inspect saved drafts/actions. Human approvals lock owned proposals and relevant records, compare the preview state, and apply at most once. Stale proposals can be refreshed and require another confirmation. Final decisions queue a continuation, reconciled idempotently when a decision request is retried.

Disconnect cancels that provider's active work and erases its credentials. Stop preserves saved transactions and staged imports. Deleting a conversation does not delete finance records. Financial edits and commits continue to use existing fixed rules, validation, duplicate checks, and reimbursement services. Reimbursement portions directed toward staged transactions follow the existing unallocated-reimbursement behavior.

Retaining a statement fixture requires an explicit approval. Approval of tested parser source and activation/rollback require separate approvals. The existing no-network parser sandbox executes generated code; Codex has no shell/environment tools.

Treat the encryption key and credential volume as secrets. To rotate V1 without implementing a V2 decryptor, first disable chat, disconnect all OpenRouter connections, generate a new key, restart both services, and have users reconnect. Never replace the key while expecting existing ciphertext to remain usable. Back up the key separately in encrypted secret storage if preserving encrypted connection rows in database backups.

Rollback by setting chat disabled and restoring prior service images. Keep the new chat tables; do not roll back the database by dropping tables or restore an old backup over new financial records. If the previous data-service runs as root it can still read the UID-1000 statement files. Keep the same Postgres and statement mounts and Compose project name.

## Verification limits

Protocol/unit/integration tests use synthetic records in a disposable database. Provider mocks do not establish live provider compatibility. Complete a synthetic tool-use conversation after connecting each real provider before considering it verified. Test native file picking, keyboard avoidance, device sign-in links, and background/resume in Expo Go on a physical phone; browser checks cover only the web runtime.
