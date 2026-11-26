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

## Daily transactions from the assistant (`transactions:write`)

An outside assistant that reads spending from emails and phone notifications
writes it straight into the ledger. The user reviews entries on the
assistant's side, so they are ordinary transactions, not drafts: they show in
the transaction list and analytics as soon as they are written. A month-end
statement upload later reconciles them.

Give the assistant's API token the `transactions:write` scope (Settings → API
Tokens, web or phone). Add `accounts:read` so it can call `list_accounts` to
pick the account.

### MCP tools

- `create_transaction`: add an entry. The same `externalId` updates the entry
  instead of adding a second row, so retries are safe.
- `get_transaction`, `update_transaction`, `delete_transaction` (needs
  `confirmed: true`): by Fortuna `transactionId` or by `externalId`.

### HTTP endpoint

The tools call the data service. The same routes are reachable through the
frontend (`http://127.0.0.1:3040` on the home server) with
`Authorization: Bearer pfa_…`; the frontend forwards only
`/api/agent/transactions/*` and `/api/agent/analytics/spending`.

| Method | Path | |
|---|---|---|
| `POST` | `/api/agent/transactions` | Create, or update by `externalId`. 201 when created, 200 when updated. |
| `GET` / `PATCH` / `DELETE` | `/api/agent/transactions/:id` | By Fortuna id. |
| `GET` / `PATCH` / `DELETE` | `/api/agent/transactions/external/:externalId` | By external id. |

Body for `POST` (`PATCH` takes the same fields, all optional, without `externalId`):

```json
{
  "externalId": "gmail:18c2f0a1b2",
  "date": "2026-11-26T12:35:00+08:00",
  "description": "KOPITIAM BEDOK",
  "label": "Lunch",
  "amountOut": 6.8,
  "currency": "SGD",
  "category": "Food",
  "account": "4265-****-****-4591",
  "card": { "last4": "4591" },
  "metadata": { "notification": "You spent SGD 6.80 at KOPITIAM BEDOK" }
}
```

- `date`: `YYYY-MM-DD` or an ISO date and time. The calendar day and clock time
  are kept as written (the row is dated that day, like statement rows; the time
  goes to `metadata.time`). `time` (`HH:MM`) can be sent separately.
- Exactly one of `amountIn` / `amountOut`, positive.
- `category`: id or exact name (case-insensitive); omitted means Uncategorized.
  `Internal` and `Reimbursement` set the matching linkage. An unknown name is a
  400 that lists the categories.
- `account`: an existing account identifier, its id or its label (see
  `list_accounts`). It may be left out when `card.last4` matches exactly one
  account identifier. An unknown account is a 400 that lists the accounts.
- `card`: `{ "id" }` or `{ "last4" }`, recorded on the transaction. (Cards get
  their own model in a later change; the card will then be resolved to it.)
- `metadata`: free-form evidence, stored under `metadata.assistant`.
- `currency` defaults to the user's base currency.

Response:

```json
{
  "created": true,
  "transaction": {
    "id": "…", "externalId": "gmail:18c2f0a1b2", "date": "2026-11-26", "time": "12:35",
    "description": "KOPITIAM BEDOK", "label": "Lunch", "amountIn": null, "amountOut": 6.8,
    "currency": "SGD", "category": { "id": "…", "name": "Food" },
    "account": "4265-****-****-4591", "card": { "last4": "4591" },
    "entrySource": "assistant", "reconciled": false, "reconciledAt": null,
    "metadata": { "notification": "…" }
  },
  "possibleDuplicates": [
    { "id": "…", "date": "2026-11-26", "description": "KOPITIAM BEDOK", "amountOut": 6.8,
      "entrySource": "statement", "reconciled": true, "matchScore": 1, "matchReasons": ["Exact amount match", "Same date", "Exact description match"] }
  ]
}
```

Possible duplicates use the same scoring as statement imports. They are
reported, not refused: the entry is saved either way.

Only entries with `entrySource: "assistant"` can be changed or deleted through
this API (409 otherwise). Every write is recorded in the agent audit log.

### Entry source and reconciliation

Every transaction has `entrySource` (`assistant`, `manual`, `statement`,
`mobile`) and `reconciled` / `reconciledAt`. Statement imports save rows as
`statement` and reconciled. The older `source` column still holds the bank
name. Both show as a badge in the web and phone transaction lists, which can
filter by them (`entrySource=assistant,mobile`, `reconciled=true|false` on
`GET /api/transactions`).
