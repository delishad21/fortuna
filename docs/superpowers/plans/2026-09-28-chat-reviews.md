# Chat workspace and synchronized transaction reviews

User-authorized extension, executed inline in the existing checkout.

1. Add owner-scoped persistent review drafts containing immutable source references, editable row snapshots and row versions. A row edit never changes finance records. Save on web blur / phone Save. Reject stale edits with a recoverable conflict.
2. Add an assistant tool to request a review of saved or staged transaction IDs. Return a review block. Submitting sends the saved draft to the assistant; consequential ledger mutations continue through existing approval previews. A new message supersedes pending reviews and pending proposals in that conversation atomically.
3. Rework web chat into a full-height workspace with hidden history, top-right new chat, per-history-item trash, bottom connection settings, avatars and solid purple selection. Move global Chat navigation after Analytics.
4. Reuse import TransactionTable for web review; add native transaction cards and an edit sheet. Both read the same persisted draft, polling for remote updates without overwriting active local input.
5. Verify ownership, concurrent edits, supersession and unchanged ledger; typecheck/build, browser checks, then deploy additive migration and refresh Expo without an APK.

Ruling: drafts preserve superseded edits as read-only history. Sending a review communicates edits to the assistant but does not approve a ledger mutation.

## Implementation and verification

Implemented with a dedicated `ChatTransactionReview` record and versioned JSON rows. Submissions snapshot saved rows into the conversation; source references remain immutable. New messages supersede pending reviews and reject pending proposals in the same conversation under the account lock.

UI inherits Fortuna's #5750F1 primary, BrandMark, icon families, existing table and form primitives; no new visual identity or design-system changes. Review targets may include saved and staged transactions. Expanded reimbursement controls preserve existing allocations and offer other targets included in the review.

Verified ownership, concurrent edits, exact saved-version submission, supersession and unchanged finance records; web blur-save and phone modal-save browser tests. A dirty expanded-input stale-value bug found during fresh review was reproduced and fixed with row-version remount keys. Captures cover desktop and Expo web at phone dimensions; physical native and dark-theme visual QA remain unverified.
