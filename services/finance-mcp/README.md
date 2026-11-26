# Finance MCP Gateway

This service exposes account-scoped finance tools to Hermes over HTTP MCP. One running container represents exactly one application account.

## Required environment

- `FINANCE_API_TOKEN`: generated under **Settings -> API Tokens**. It authenticates the gateway to the data service and determines the only account the gateway can access.
- `MCP_CLIENT_TOKEN`: an independent random secret used by Hermes as the Bearer token for the `/mcp` endpoint.

Optional settings include `PORT` (default `4002`), `HOST`, `DATA_SERVICE_URL`, `PARSER_SERVICE_URL`, and comma-separated `MCP_ALLOWED_HOSTS`.

## Development

After applying the data-service migration and generating an account token:

```sh
export FINANCE_API_TOKEN='pfa_...'
export MCP_CLIENT_TOKEN='replace-with-an-independent-random-secret'
docker compose -f docker-compose.dev.yml --profile hermes up -d finance-mcp
```

Hermes connects to `http://127.0.0.1:4002/mcp` with `Authorization: Bearer <MCP_CLIENT_TOKEN>`. The health endpoint is `GET /health`.

Remote statement bytes are sent to `POST /upload` with the same MCP ingress
Bearer token, the original filename in `X-Filename`, and the document MIME type
in `Content-Type`. The response contains an opaque `fileRef` for MCP tools.

The gateway validates `FINANCE_API_TOKEN` at startup and exits if it is missing, invalid, expired, or revoked. Tool schemas intentionally contain no `userId` field.

## Statement uploads from a server (`statements:write`)

A server that receives statements itself (twee, at month end) uploads them
straight to Fortuna and passes the assistant only the statement id, so the
file and any PDF password never go through the model.

`POST /api/agent/statements` with `Authorization: Bearer pfa_…` and a
`multipart/form-data` body. On the home server it is reachable through the
frontend at `http://127.0.0.1:3040/api/agent/statements` (the public site's
nginx allows 20 MB bodies).

| Field | | |
|---|---|---|
| `file` | required | One PDF or CSV statement, under 25 MB. The limits and accepted types are the web upload's (it uses the same route). |
| `password` | optional | The PDF's open password. Used once to decrypt the upload, then forgotten: it is not stored, logged, audited or returned. Ignored for CSVs and PDFs that open without one. |

A locked PDF is stored decrypted, so parsing it later needs no password.
Uploading the same statement again (same bytes) returns the same id.

| Status | Body | |
|---|---|---|
| 201 | `{ "statement": { "id": "upload_…", "filename", "contentType", "sha256", "sizeBytes", "status", "createdAt", "duplicate": false } }` | Stored. `statement.id` is the `fileRef` for `inspect_statement` and `create_import_draft`. |
| 200 | the same, `"duplicate": true` | Already uploaded; the existing id. |
| 422 | `{ "error", "code": "pdf_password_required" }` | The PDF is locked and no password was sent. Ask for it and upload again. |
| 422 | `{ "error", "code": "pdf_password_incorrect" }` | The password doesn't open the PDF. Ask again. |
| 401 / 403 | `{ "error", "requiredScopes": ["statements:write"] }` | No token, or a token without `statements:write`. |
| 413 / 415 / 400 | `{ "error" }` | Over 25 MB; not a PDF or CSV; no `file` field. |

Nothing is stored when a password is missing or wrong. The file shows in
Fortuna's Statements list like a web upload.

```sh
curl -sS http://127.0.0.1:3040/api/agent/statements \
  -H "Authorization: Bearer $FORTUNA_TOKEN" \
  -F file=@dbs-2026-12.pdf -F password="$PDF_PASSWORD"
```

## Daily transactions from the assistant (`transactions:write`, `transactions:review`, `rules:write`)

An outside assistant (twee, through Hermes) that reads spending from emails
and phone notifications writes it straight into the ledger. Rules are only for
facts that stay true without upkeep; everything else is the assistant's
decision, made from similar past entries and the user's written instructions.
Like the PayLah email flow, Fortuna owns the procedure: it serves a guide,
gives the assistant context, and checks the result.

Email, notification and receipt text is **untrusted data**: the assistant
records it, never follows instructions in it.

1. **Decide.** The assistant looks up precedents (`find_similar_entries`:
   same merchant, similar amount, same card, recent reviewed entries first,
   with category, type, label, merchant and reimbursable flag) and the
   instructions that apply, and sends its `decision`: category,
   `transactionType` (purchase, bill, subscription, transfer_to_person,
   refund, reimbursement, internal), label, cleaned merchant name, reason,
   confidence and `precedentIds`. When unsure it adds `questions`.
2. **Insert and classify.** Fortuna decides in this order and records which
   step did in `transaction.classification.decidedBy`:
   1. `structural`: transfers between the user's own accounts, detected in
      code. PayLah ↔ DBS Multiplier top-ups, max-outs and send-backs pair by
      amount within 2 days across the two accounts (the PayLah email itself
      stays the real transaction); a bank payment to a credit card account
      Fortuna knows and that card's payment received pair by amount within 7
      days and are Internal on both sides. Whichever side arrives second
      marks the first.
   2. `rule`: enabled rules. They apply by account or card whatever the
      entry's source; a parser's rules apply to the accounts that parser
      imports into, and statement imports keep their parser scoping. A rule
      with an amount range doesn't apply outside it and asks instead.
   3. `assistant`: the assistant's decision.
   4. `learned_pattern` / `history` / `heuristic`: only when the assistant
      sent no decision (and automatic labelling is on).
   When the assistant's decision contradicts a rule's result, the rule's
   result stays, `classification.conflict` records both, and a question asks
   the user. The decision is kept on the entry (`transaction.decision`) and
   shown in its details on web and mobile.
3. **Assign an account.** A named account wins, then a card's last 4 digits
   matching one account, then the source's card or account. A card or
   account Fortuna doesn't know is **not created**: the entry is booked to no
   account with an `account` question (add the card to an existing account,
   create a new account, or link the identifier). Answering creates it, books
   every entry asking the same, and adds the message's channel as an entry
   source. Only an entry naming neither goes to a shared account Fortuna
   creates (`autoCreated`, in `accountCreated`).
4. **Queue for review.** Every assistant entry starts `to_review` with
   `reviewReasons`: `no_rule_matched`, `assistant_category` (the decision was
   used), `low_confidence` (below 0.6), `question`, `unknown_account`,
   `new_account`, `possible_duplicate`, `rule_undone`. Statement imports,
   manual and phone entries are `reviewed`.
5. **Review from either side.** In Fortuna's To review screen (web and phone:
   question chips, the decision with its precedents, new rules with Undo) or
   by the assistant with the review tools.

What to watch lives in Fortuna too: each account or card has **sources**
(Settings → Sources) that say how its transactions arrive, with a main and a
backup channel (DBS: the Multiplier account's alerts are the main channel,
card 5128's a backup). See [Sources and externalIds](#sources-and-externalids).

### Rules the assistant creates (`rules:write`)

Each rule has an `origin` (`user`, `assistant_on_request`,
`assistant_detected`), a `reason`, example transaction ids, `hitCount` and
`lastHitAt`, an optional amount range and an optional account or card scope.

- Create rules only for facts that stay true without upkeep: a card's channel
  ("UOB card BUS/MRT is Internal": SimplyGo holds the trips), a fixed
  recurring bill, a merchant that is always one category. Spending that needs
  judgement stays the assistant's decision.
- `assistant_on_request`: the user asked for it; `reason` is their words.
- `assistant_detected`: the assistant saw it; it needs a `reason` and at
  least 3 reviewed examples the rule matches and that are already classified
  that way, or a stated `recurringBill { name, amount?, frequency? }`.
- No `confirmed: true` flag is needed for either.
- The review queue's `newRules` lists `assistant_detected` rules created since
  the last review, so twee shows them with **Undo**; Undo disables the rule and
  puts the entries it classified back in review (assistant entries are
  classified again without it). Marking entries reviewed acknowledges them.
- The rules screens on web and phone show origin, reason, examples and hit
  stats, with an on/off switch.

Scopes (Settings → API Tokens, web or phone):

- `transactions:write`: write entries, read the guide and context.
- `transactions:review`: list the queue, correct entries (statement rows
  too), answer questions, mark them reviewed, undo rules, confirm or merge
  accounts Fortuna created, read the guide and context.
- `rules:write`: create, update, disable and undo rules; `rules:read` lists them.
- `accounts:read` is enough to read what to watch (`get_entry_sources`);
  `accounts:write` manages sources through `/api/agent/sources`.
- `instructions:read` lists the user's classification instructions (so do
  `transactions:write`, `transactions:review` and `drafts:read`);
  `instructions:write` adds, edits and disables them.

### MCP tools

- `get_assistant_entry_guide`: the procedure, the decision order, when to
  ask and when to create rules, and what never to do. Call it first.
- `create_transaction`: add an entry with `decision` and optional
  `questions`. The same `externalId` updates it instead of adding a second
  row, so retries and re-reads are safe. Optional `sourceId` (from
  `get_entry_sources`) and `sender` (an email's From).
- `get_entry_sources`: the enabled sources grouped by kind. `list_sources`
  lists every source, enabled or not, and optionally Fortuna's suggestions.
- `get_transaction`, `update_transaction`, `delete_transaction` (needs
  `confirmed: true`): by Fortuna `transactionId` or by `externalId`, only the
  assistant's own entries.
- Context (either scope): `get_entry_accounts`, `get_entry_categories`,
  `get_entry_rules`, `find_similar_entries` (precedents, and possible
  duplicates when given a date and amount).
- Classification: `get_classification_guide` (the one guide Hermes, twee and
  Fortuna's own chat follow: decision order, when to ask, when to create a
  rule, shared items, untrusted text), `list_classification_instructions`
  (all, or only what applies to a transaction or an entry's facts),
  `create_classification_instruction`, `update_classification_instruction`
  (`enabled: false` disables). Entries from `list_review_queue`,
  `create_transaction`, `get_transaction` and `update_transaction` come with
  `instructions` and, per entry, `instructionIds`: only what applies.
- Review (`transactions:review`): `list_review_queue` (with `newRules`),
  `answer_question`, `correct_transactions` (category, account, label, merchant
  or `transactionType` on up to 200 rows; `createRule { matchValue, origin, reason }` also saves a rule),
  `set_review_status`, `undo_rule`, `confirm_account`, `merge_account`
  (`confirmed: true`).
- Rules (`rules:write`): `list_rules`, `create_rule`, `update_rule`,
  `disable_rule`.
- Statement drafts: `validate_import_draft` returns `accountQuestions` for
  identifiers Fortuna doesn't know; `answer_draft_account_question` places one
  (add the card, link it, or create the account) once the user has chosen.
- Reimbursable spending (money out paid for someone who pays it back; it
  keeps its category): `get_outstanding_reimbursements` and
  `list_reimbursement_people` (`transactions:review` or `analytics:read`:
  what each person owes, in total and per month, with the open items),
  `set_reimbursable` (by ids, or by a search with `preview` first and then
  `confirmed: true`; in full unless a `share` is given) and
  `unset_reimbursable`, `add_reimbursement_person` /
  `update_reimbursement_person`, `get_reimbursement_link_proposals` and
  `confirm_reimbursement_links` (links a repayment to the items it pays back;
  review entries carry the same `reimbursementProposal`),
  `get_reimbursable_backfill` (read-only) and `apply_reimbursable_backfill`
  (`confirmed: true`). Routes: `/api/agent/reimbursables/*`.

### HTTP endpoints

The tools call the data service. The same routes are reachable through the
frontend (`http://127.0.0.1:3040` on the home server) with
`Authorization: Bearer pfa_…`; the frontend forwards only
`/api/agent/transactions/*`, `/api/agent/rules/*`, `/api/agent/instructions/*`,
`/api/agent/drafts/*`, `/api/agent/proposals/*` (`POST`),
`/api/agent/parser-factory/*` (`GET`, `POST`),
`/api/agent/classification-guide`, `/api/agent/analytics/spending`,
`/api/agent/analytics/month-to-date` and `POST /api/agent/statements` (see
[Statement uploads from a server](#statement-uploads-from-a-server-statementswrite)). The web and phone apps' To review
screen calls the same `/review` routes (as the trusted frontend), so twee and
Fortuna work through one queue.

| Method | Path | Scope | |
|---|---|---|---|
| `POST` | `/api/agent/transactions` | write | Create, or update by `externalId`. 201 when created, 200 when updated. |
| `GET` / `PATCH` / `DELETE` | `/api/agent/transactions/:id` | write | By Fortuna id. |
| `GET` / `PATCH` / `DELETE` | `/api/agent/transactions/external/:externalId` | write | By external id. |
| `GET` | `/api/agent/transactions/guide` | either | The assistant-entry guide. |
| `GET` | `/api/agent/transactions/context/accounts` | either | Accounts with `last4`, `autoCreated`, transaction counts. |
| `GET` | `/api/agent/transactions/context/sources` | either, or `accounts:read` | Enabled sources grouped by kind. |
| `GET` | `/api/agent/transactions/context/categories` | either | Main-ledger categories. |
| `GET` | `/api/agent/transactions/context/rules` | either | Rules (with origin, reason, hits) and auto-applied learned patterns. |
| `GET` | `/api/agent/transactions/context/similar?description=&amount=&card=&date=&direction=&limit=` | either | Precedents and possible duplicates. |
| `GET` | `/api/agent/transactions/review?status=&reasons=&entrySource=&account=&dateFrom=&dateTo=&limit=&offset=` | review | The queue, counts per reason, `newRules`, and per entry its questions, decision and `precedents`. |
| `POST` | `/api/agent/transactions/review/correct` | review | `{ ids, category?, account?, label?, markReviewed?, createRule? }` |
| `POST` | `/api/agent/transactions/review/status` | review | `{ ids, status: "reviewed" \| "to_review" }` |
| `POST` | `/api/agent/transactions/review/questions/answer` | review | `{ transactionId, questionId, option? \| value?, markReviewed? }` |
| `POST` | `/api/agent/transactions/review/rules/:ruleId/undo` | review | Disable the rule and reopen what it classified. |
| `POST` | `/api/agent/transactions/review/accounts/:account/confirm` | review | `{ label? }` |
| `POST` | `/api/agent/transactions/review/accounts/:account/merge` | review | `{ into, confirmed: true }`; only for `autoCreated` accounts. |
| `GET` | `/api/agent/classification-guide` | `instructions:read`, either, or `drafts:read` | The classification guide. |
| `GET` | `/api/agent/instructions?status=&transactionId=&accountId=&cardId=&accountIdentifier=&entrySource=&description=` | `instructions:read`, either, or `drafts:read` | Classification instructions; with an entry, only the active ones that apply to it. |
| `POST` | `/api/agent/instructions` | `instructions:write` | `{ text, scope?, kind?, endsOn? }`; scope is `{type:"account",accountId}`, `{type:"card",cardId}`, `{type:"entry_source",entrySource}` or `{type:"merchant",pattern}`. |
| `PATCH` | `/api/agent/instructions/:id` | `instructions:write` | Any of `text`, `scope`, `kind`, `endsOn`, `enabled`. |
| `GET` | `/api/agent/rules?origin=&enabled=` | rules:read, rules:write or review | Rules with stats and examples. |
| `POST` | `/api/agent/rules` | rules:write | Create (`origin`, `reason`, `exampleIds` or `recurringBill`, `matchValue`, `account`/`card`, `setCategory`/`setLabel`/`markInternal`, `amountMin`/`amountMax`). |
| `PATCH` | `/api/agent/rules/:id` | rules:write | Change, or `enabled`. |
| `POST` | `/api/agent/rules/:id/disable` \| `enable` \| `undo` | rules:write | |
| `POST` | `/api/agent/drafts` | drafts:write | Create a draft. |
| `GET` | `/api/agent/drafts?status=` | drafts:read | Drafts. |
| `GET` / `DELETE` | `/api/agent/drafts/:draftId` | drafts:read / drafts:write | One draft with its rows, reconciliation and proposals; or discard it. |
| `POST` | `/api/agent/drafts/:draftId/parse` | statements:write + drafts:write | `{ parserId? }` |
| `PATCH` | `/api/agent/drafts/:draftId/rows/:rowId` | drafts:write | Change a row. |
| `PATCH` | `/api/agent/drafts/:draftId/reconcile` | drafts:write | `{ expectedVersion, rows?: [{ rowId, transactionId }], entries?: [{ transactionId, action: keep \| delete \| move, accountId? }] }`: match rows to entries, or settle unmatched entries. |
| `PATCH` | `/api/agent/drafts/:draftId/account` | drafts:write + accounts:read | The account the draft belongs to. |
| `POST` | `/api/agent/drafts/:draftId/account-questions/answer` | drafts:write + accounts:write | `{ identifier, option, name? }` |
| `POST` | `/api/agent/drafts/:draftId/proposals` | classification:write | Submit proposals. |
| `POST` | `/api/agent/proposals/:proposalId/decision` | drafts:write | `{ decision }` |
| `POST` | `/api/agent/drafts/:draftId/validate` | drafts:read | Check the draft before commit. |
| `POST` | `/api/agent/drafts/:draftId/commit` | imports:commit | Commit the draft to the ledger. |
| `POST` | `/api/agent/drafts/validate-selection` \| `commit-selection` | drafts:read \| imports:commit | `{ draftIds, … }` |
| `POST` | `/api/agent/parser-factory/workspaces` | parser:develop | Open a workspace. |
| `GET` | `/api/agent/parser-factory/workspaces/:workspaceId` | parser:develop | The workspace, its fixtures and candidates. |
| `GET` | `/api/agent/parser-factory/workspaces/:workspaceId/fixtures/:fileId/inspect` | parser:develop | |
| `POST` | `/api/agent/parser-factory/workspaces/:workspaceId/candidates` | parser:develop | Stage a candidate. |
| `POST` | `/api/agent/parser-factory/workspaces/:workspaceId/candidates/:candidateId/test` \| `submit` | parser:develop | |
| `POST` | `/api/agent/parser-factory/workspaces/:workspaceId/candidates/:candidateId/approve` | parser:approve | `{ confirmed: true }` |
| `GET` | `/api/agent/parser-factory/definitions` | parser:develop | Parser definitions and versions. |
| `POST` | `/api/agent/parser-factory/definitions/:definitionId/versions/:versionId/activate` | parser:approve | `{ confirmed: true }` |
| `GET` | `/api/agent/analytics/spending?groupBy=category\|month\|merchant\|account&from=&to=&category=&limit=` | analytics:read | Money out per group. |
| `GET` | `/api/agent/analytics/month-to-date?today=` | analytics:read | The dashboard's month so far: `spent`, `todaySpent`, `weekSpent` (from Monday), `previous.spentSameDay` and `spentTotal`, `projected` (month-end at this pace) and `categories`. `today` defaults to today in Singapore. |

`account` in the review routes is an Account id, a statement identifier or an
account name; accounts without a statement identifier are found by id or name.

Body for `POST /api/agent/transactions` (`PATCH` takes the same fields, all
optional, without `externalId`):

```json
{
  "externalId": "email:CAF7xk2Qp9@mail.gmail.com",
  "sender": "UOB Alerts <unialerts@uobgroup.com>",
  "date": "2026-11-26T12:35:00+08:00",
  "description": "KOPITIAM BEDOK",
  "amountOut": 6.8,
  "currency": "SGD",
  "card": { "last4": "4591" },
  "decision": {
    "category": "Food",
    "transactionType": "purchase",
    "label": "Lunch",
    "merchant": "Kopitiam Bedok",
    "reason": "Same as the last 4 reviewed Kopitiam lunches",
    "confidence": 0.9,
    "precedentIds": ["cm…", "cm…"]
  },
  "questions": [{ "field": "reimbursable", "prompt": "Shared with Madeline?", "options": ["Full", "Half", "Not shared"] }],
  "metadata": { "notification": "You spent SGD 6.80 at KOPITIAM BEDOK" }
}
```

- `externalId`: fixed per message, see [Sources and externalIds](#sources-and-externalids).
- `sourceId` / `sender`: which source the message came from. Optional.
- `date`: `YYYY-MM-DD` or an ISO date and time, kept as written.
- Exactly one of `amountIn` / `amountOut`, positive.
- `description`: as the bank or notification shows it; rules and transfer
  detection match on it. The clean name goes in `decision.merchant`.
- `decision`: as above. `suggestedCategory` (the older field) is still
  accepted as `decision.category`. An unknown category is ignored with a
  warning.
- `account`, `card` (`{ "id" }` or `{ "last4" }`), `accountName` (names the
  account if the user creates one for an unknown card).
- `metadata`: free-form evidence, stored under `metadata.assistant`.

The response has `transaction` (with `classification`, `decision`,
`merchant`, `transactionType`, `questions`, `reviewReasons`, `sources`),
`possibleDuplicates` (scored like statement imports, reported not refused),
`accountCreated` (only for the shared unassigned account) and `warnings`.

Only entries with `entrySource: "assistant"` can be changed or deleted through
the write routes (409 otherwise); corrections through `/review/correct` work
on any transaction. A category set by a correction stands: later updates from
the assistant don't reclassify it. Every write and review action is recorded
in the agent audit log.

### Sources and externalIds

A **source** is how one account's or one card's transactions reach the
assistant. Several per account or card; each has:

- `kind`: `notification` (a bank app's phone notifications, caught by twee's
  listener) or `email` (alert emails, searched by a Hermes cron job every
  30–60 minutes).
- `senders`: the app packages (`sg.com.transitlink`) or sender addresses
  (`paylah.alert@dbs.com`).
- `subjectPatterns`, `textPatterns`: optional text the subject or body
  contains (case-insensitive, any of them).
- `identifiers`: what ties a message to the card or account, e.g.
  `card ending 1234`. Used to tell sources with the same sender apart.
- `channel`: `main` or `backup` (see below); `enabled`; `notes`.

New sources start disabled, and only enabled ones are served. Settings →
Sources (web and phone) also suggests sources Fortuna can tell from imports
(PayLah alert emails for the account PayLah statements import into, the
SimplyGo app for the SimplyGo account); a suggestion is only added when the
user adds it, and stays off until they turn it on.

`GET /api/agent/transactions/context/sources` (`get_entry_sources`, also in
the guide as `sources.watching`) returns what to watch:

```json
{
  "notification": {
    "externalId": "notif:<package>:<key>:<postTime>",
    "packages": ["sg.com.transitlink"],
    "sources": [{ "id": "…", "name": "SimplyGo app", "account": { "id": "…", "name": "SimplyGo (UOB Credit Card)", "type": "credit_card" },
                  "card": null, "channel": "main", "senders": ["sg.com.transitlink"], "subjectPatterns": [], "textPatterns": [], "identifiers": [], "notes": "…" }]
  },
  "email": {
    "externalId": "email:<Message-ID>",
    "senders": ["paylah.alert@dbs.com"],
    "sources": [{ "id": "…", "name": "PayLah alert emails", "subjectPatterns": ["Transaction Alerts"], "…": "…" }]
  }
}
```

twee's listener allows `notification.packages`; the mail job searches
`email.senders` (with each source's `subjectPatterns`). Adding a bank is a
settings change in Fortuna, not a prompt edit.

**externalIds are fixed per message**, and enforced (400 otherwise):

| Kind | externalId | Example |
|---|---|---|
| email | `email:` + the Message-ID header (angle brackets dropped) | `email:CAF7xk2Qp9@mail.gmail.com` |
| notification | `notif:` + package + `:` + key (`StatusBarNotification.getKey()`) + `:` + post time (`getPostTime()`, epoch ms) | `notif:sg.com.transitlink:0\|sg.com.transitlink\|7\|null\|10213:1764131700000` |
| anything else | any stable id not starting with `email:` or `notif:` | `receipt-2026-11-26-1` |

A source only takes ids of its kind, and a notification source only its own
packages. Every message gets a report (`transaction_source_reports`) tying
its externalId to one transaction, so a cron job can re-read the last 2 days
on every run:

- a known id updates its entry (200, `created: false`);
- a backup message already merged into another entry updates nothing
  (`merged`);
- the id of an entry that was deleted, in Fortuna or through the API, is
  skipped (`skipped: "deleted"`, `transaction: null`) rather than added again.

**Main and backup channels.** When a card's main channel (say app
notifications) and backup channel (alert emails) both report a purchase,
there is one transaction. A new message from a source with a channel is
compared with the account's assistant entries with the same amount within
2 days that the other channel reported and this source hasn't: the
statement-import duplicate score, plus 0.2 for the same card and 0.2 for
clock times within 10 minutes (more than 30 minutes apart, or different
cards, is a different purchase), must reach 0.8.

- A backup's message about the main channel's entry is merged into it
  (`created: false`, `merged: { into, as: "backup", matchScore,
  matchReasons }`); the entry is unchanged apart from `sources`.
- A main channel's message about an entry only the backup reported takes it
  over (`merged.as: "main"`): the entry gets the main message's externalId and
  facts, and the backup's message stays linked.

`transaction.sources` lists every message behind an entry with its source,
kind, channel and which one is primary. `DELETE
/api/agent/transactions/external/:externalId` with a merged backup's id only
unlinks that message.

Managing sources (`accounts:read` to read, `accounts:write` with
`confirmed: true` to change; the web and phone apps use the same routes):

| Method | Path | |
|---|---|---|
| `GET` | `/api/agent/sources?accountId=&kind=&enabled=` | Every source, with `reportCount`. |
| `GET` | `/api/agent/sources/watchlist` | The same as `context/sources`. |
| `GET` | `/api/agent/sources/suggestions` | Suggested sources, never added by themselves. |
| `POST` | `/api/agent/sources` | `{ kind, accountId \| cardId, senders, name?, subjectPatterns?, textPatterns?, identifiers?, channel?, enabled?, notes? }` |
| `PATCH` / `DELETE` | `/api/agent/sources/:id` | Change or delete one. Deleting keeps its messages' reports. |

### Entry source and reconciliation

Every transaction has `entrySource` (`assistant`, `manual`, `statement`,
`mobile`) and `reconciled` / `reconciledAt`. Statement imports save rows as
`statement` and reconciled. The older `source` column still holds the bank
name. Both show as a badge in the web and phone transaction lists, which can
filter by them (`entrySource=assistant,mobile`, `reconciled=true|false` on
`GET /api/transactions`). Rows waiting for review carry a *To review* badge,
and `reviewStatus=to_review|reviewed` filters the same lists.
