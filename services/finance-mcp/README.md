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
