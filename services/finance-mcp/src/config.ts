function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseAllowedHosts(value: string | undefined) {
  return new Set(
    (value || "localhost,127.0.0.1")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
}

export const config = {
  port: Number(process.env.PORT || 4002),
  host: process.env.HOST?.trim() || "0.0.0.0",
  dataServiceUrl: process.env.DATA_SERVICE_URL?.trim() || "http://data-service:4001",
  parserServiceUrl: process.env.PARSER_SERVICE_URL?.trim() || "http://file-parser:4000",
  statementInbox: process.env.STATEMENT_INBOX?.trim() || null,
  financeApiToken: required("FINANCE_API_TOKEN"),
  mcpClientToken: required("MCP_CLIENT_TOKEN"),
  allowedHosts: parseAllowedHosts(process.env.MCP_ALLOWED_HOSTS),
};

if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
  throw new Error("PORT must be a valid TCP port");
}
