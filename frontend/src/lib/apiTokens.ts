export const API_TOKEN_SCOPES = [
  "statements:write",
  "drafts:read",
  "drafts:write",
  "classification:write",
  "trips:read",
  "trips:write",
  "rules:read",
  "rules:write",
  "imports:commit",
  "parser:develop",
  "parser:approve",
  "accounts:read",
  "accounts:write",
] as const;

export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

export const DEFAULT_HERMES_SCOPES: ApiTokenScope[] = [
  "statements:write",
  "drafts:read",
  "drafts:write",
  "classification:write",
  "trips:read",
  "rules:read",
  "accounts:read",
  "accounts:write",
];

export interface ApiTokenSummary {
  id: string;
  name: string;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface CreatedApiToken extends ApiTokenSummary {
  token: string;
}
