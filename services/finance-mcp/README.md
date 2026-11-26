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

## Daily transactions from the assistant (`transactions:write`, `transactions:review`)

An outside assistant (twee) that reads spending from emails and phone
notifications writes it straight into the ledger, and Fortuna decides what it
is. Like the PayLah email flow, Fortuna owns the procedure: it serves a guide,
gives the assistant context, and checks the result.

1. **Insert.** The assistant sends the raw facts: amount, merchant as shown,
   date and time, the card's last 4 digits, the original evidence, and
   optionally its own category guess. The entry shows in the transaction list
   and analytics at once.
2. **Classify.** Fortuna runs its own classification, the same as for
   statement rows: import rules, then learned patterns, history and heuristics
   when automatic labelling is on in Settings. The assistant's
   `suggestedCategory` is used only when none of them chooses a category.
   `transaction.classification.decidedBy` records who decided: `rule` (with
   `ruleId`), `learned_pattern`, `history`, `heuristic`, `assistant`,
   `correction` or `none`.
3. **Assign an account.** A named account wins, then a card's last 4 digits
   that end exactly one account identifier. When nothing matches, Fortuna
   creates the account itself (`autoCreated`, with what created it in
   `autoCreatedFrom`) and returns it in `accountCreated`. The assistant never
   invents one.
4. **Queue for review.** Every assistant entry starts `reviewStatus:
   "to_review"` with `reviewReasons`: `no_rule_matched`, `assistant_category`
   (the suggestion was used), `new_account` (on an account nobody has
   confirmed yet), `possible_duplicate`. Any later update from the assistant
   puts the entry back in the queue. Statement imports, manual and phone
   entries, and every row from before this change, are `reviewed`.
5. **Review from either side.** In Fortuna (web and phone lists show a *To
   review* badge and filter by it) or by the assistant with the review tools.

What to watch lives in Fortuna too: each account or card has **sources**
(Settings → Sources, web and phone) that say how its transactions arrive. See
[Sources and externalIds](#sources-and-externalids).

Scopes (Settings → API Tokens, web or phone):

- `transactions:write`: write entries, read the guide and context.
- `transactions:review`: list the queue, correct entries (statement rows
  too), mark them reviewed, confirm or merge accounts Fortuna created, read
  the guide and context.
- `accounts:read` is enough to read what to watch (`get_entry_sources`);
  `accounts:write` manages sources through `/api/agent/sources`.

### MCP tools

- `get_assistant_entry_guide`: the procedure, what Fortuna decides, and what
  never to do. Call it first.
- `create_transaction`: add an entry. The same `externalId` updates it instead
  of adding a second row, so retries and re-reads are safe. Optional
  `sourceId` (from `get_entry_sources`) and `sender` (an email's From).
- `get_entry_sources`: the enabled sources grouped by kind, with the app
  packages and email senders to watch. `list_sources` lists every source,
  enabled or not, and optionally Fortuna's suggestions.
- `get_transaction`, `update_transaction`, `delete_transaction` (needs
  `confirmed: true`): by Fortuna `transactionId` or by `externalId`, only the
  assistant's own entries.
- Context (either scope): `get_entry_accounts`, `get_entry_categories`,
  `get_entry_rules`, `find_similar_entries` (past labels and categories for the
  merchant, and possible duplicates when given a date and amount).
- Review (`transactions:review`): `list_review_queue`, `correct_transactions`
  (category, account or label on up to 200 rows; `createRule` with
  `confirmed: true` also saves an enabled import rule), `set_review_status`,
  `confirm_account`, `merge_account` (`confirmed: true`).

### HTTP endpoints

The tools call the data service. The same routes are reachable through the
frontend (`http://127.0.0.1:3040` on the home server) with
`Authorization: Bearer pfa_…`; the frontend forwards only
`/api/agent/transactions/*` and `/api/agent/analytics/spending`.

| Method | Path | Scope | |
|---|---|---|---|
| `POST` | `/api/agent/transactions` | write | Create, or update by `externalId`. 201 when created, 200 when updated. |
| `GET` / `PATCH` / `DELETE` | `/api/agent/transactions/:id` | write | By Fortuna id. |
| `GET` / `PATCH` / `DELETE` | `/api/agent/transactions/external/:externalId` | write | By external id. |
| `GET` | `/api/agent/transactions/guide` | either | The assistant-entry guide. |
| `GET` | `/api/agent/transactions/context/accounts` | either | Accounts with `last4`, `autoCreated`, transaction counts. |
| `GET` | `/api/agent/transactions/context/sources` | either, or `accounts:read` | Enabled sources grouped by kind: `notification.packages`, `email.senders`, each source with its account or card, patterns, identifiers and channel. |
| `GET` | `/api/agent/transactions/context/categories` | either | Main-ledger categories. |
| `GET` | `/api/agent/transactions/context/rules` | either | Import rules and auto-applied learned patterns. |
| `GET` | `/api/agent/transactions/context/similar?description=&date=&amount=` | either | Similar past transactions and possible duplicates. |
| `GET` | `/api/agent/transactions/review?status=&reasons=&entrySource=&account=&dateFrom=&dateTo=&limit=&offset=` | review | The queue, with counts per reason. |
| `POST` | `/api/agent/transactions/review/correct` | review | `{ ids, category?, account?, label?, markReviewed?, createRule? }` |
| `POST` | `/api/agent/transactions/review/status` | review | `{ ids, status: "reviewed" \| "to_review" }` |
| `POST` | `/api/agent/transactions/review/accounts/:account/confirm` | review | `{ label? }` |
| `POST` | `/api/agent/transactions/review/accounts/:account/merge` | review | `{ into, confirmed: true }`; only for `autoCreated` accounts. |

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
  "accountName": "UOB One Card",
  "suggestedCategory": "Food",
  "metadata": { "notification": "You spent SGD 6.80 at KOPITIAM BEDOK" }
}
```

- `externalId`: fixed per message, see [Sources and externalIds](#sources-and-externalids).
- `sourceId` / `sender`: which source the message came from. Optional:
  Fortuna finds the source from a notification's package or an email's sender.
- `date`: `YYYY-MM-DD` or an ISO date and time. The calendar day and clock time
  are kept as written (the row is dated that day, like statement rows; the time
  goes to `metadata.time`). `time` (`HH:MM`) can be sent separately.
- Exactly one of `amountIn` / `amountOut`, positive.
- `description`: as the bank or notification shows it; Fortuna's rules match
  on it.
- `suggestedCategory`: id or name (case-insensitive), used only when no rule
  decides. `Internal` and `Reimbursement` set the matching linkage. An unknown
  name leaves the entry Uncategorized and comes back in `warnings`.
- `account`: an existing account identifier, id or label (see
  `get_entry_accounts`), or the account number the evidence shows. Optional.
- `card`: `{ "id" }` or `{ "last4" }`, recorded on the transaction and used to
  find the account and card. Left out, the source's card or account books it.
- `accountName`: names the account when Fortuna has to create one.
- `label`: optional; a rule may set one when it is left out.
- `metadata`: free-form evidence, stored under `metadata.assistant`.
- `currency` defaults to the user's base currency.

Response:

```json
{
  "created": true,
  "transaction": {
    "id": "…", "externalId": "email:CAF7xk2Qp9@mail.gmail.com", "date": "2026-11-26", "time": "12:35",
    "description": "KOPITIAM BEDOK", "label": "Kopitiam", "amountIn": null, "amountOut": 6.8,
    "currency": "SGD", "category": { "id": "…", "name": "Food" },
    "account": "****4591", "card": { "last4": "4591" },
    "entrySource": "assistant", "reconciled": false, "reconciledAt": null,
    "reviewStatus": "to_review", "reviewReasons": ["new_account", "possible_duplicate"], "reviewedAt": null,
    "classification": { "decidedBy": "rule", "ruleId": "…", "ruleName": "Kopitiam is Food", "suggestedCategory": "Food", "at": "…" },
    "sources": [{ "externalId": "email:CAF7xk2Qp9@mail.gmail.com", "sourceId": "…", "kind": "email", "channel": "main", "name": "UOB alerts", "primary": true }],
    "metadata": { "notification": "…" }
  },
  "accountCreated": { "id": "…", "accountIdentifier": "****4591", "label": "UOB One Card", "autoCreated": true },
  "possibleDuplicates": [
    { "id": "…", "date": "2026-11-26", "description": "KOPITIAM BEDOK", "amountOut": 6.8,
      "entrySource": "statement", "reconciled": true, "matchScore": 1, "matchReasons": ["Exact amount match", "Same date", "Exact description match"] }
  ]
}
```

Possible duplicates use the same scoring as statement imports. They are
reported, not refused: the entry is saved either way.

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
