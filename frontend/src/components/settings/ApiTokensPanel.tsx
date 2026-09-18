"use client";

import { useState } from "react";
import { Copy, KeyRound, RefreshCw, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { TextInput } from "@/components/ui/TextInput";
import {
  createApiToken,
  revokeApiToken,
  rotateApiToken,
} from "@/app/actions/apiTokens";
import {
  API_TOKEN_SCOPES,
  DEFAULT_HERMES_SCOPES,
  type ApiTokenSummary,
} from "@/lib/apiTokens";

interface ApiTokensPanelProps {
  initialTokens: ApiTokenSummary[];
}

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

export function ApiTokensPanel({ initialTokens }: ApiTokensPanelProps) {
  const [tokens, setTokens] = useState(initialTokens);
  const [name, setName] = useState("Hermes MCP");
  const [expiresInDays, setExpiresInDays] = useState("365");
  const [scopes, setScopes] = useState<string[]>([...DEFAULT_HERMES_SCOPES]);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [busyTokenId, setBusyTokenId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCreate = async () => {
    setIsCreating(true);
    setError(null);
    try {
      const created = await createApiToken({
        name,
        scopes,
        expiresInDays: expiresInDays.trim() ? Number(expiresInDays) : null,
      });
      const { token, ...summary } = created;
      setTokens((current) => [summary, ...current]);
      setRevealedToken(token);
      setCopied(false);
    } catch (creationError) {
      setError(creationError instanceof Error ? creationError.message : "Failed to create token");
    } finally {
      setIsCreating(false);
    }
  };

  const handleRevoke = async (tokenId: string) => {
    if (!window.confirm("Revoke this API token? Its MCP container will immediately lose access.")) {
      return;
    }
    setBusyTokenId(tokenId);
    setError(null);
    try {
      const updated = await revokeApiToken(tokenId);
      setTokens((current) => current.map((token) => (token.id === tokenId ? updated : token)));
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : "Failed to revoke token");
    } finally {
      setBusyTokenId(null);
    }
  };

  const handleRotate = async (tokenId: string) => {
    if (!window.confirm("Rotate this token? The old token will be revoked immediately.")) return;
    setBusyTokenId(tokenId);
    setError(null);
    try {
      const created = await rotateApiToken(tokenId);
      const { token, ...summary } = created;
      const now = new Date().toISOString();
      setTokens((current) => [
        summary,
        ...current.map((item) => (item.id === tokenId ? { ...item, revokedAt: item.revokedAt || now } : item)),
      ]);
      setRevealedToken(token);
      setCopied(false);
    } catch (rotateError) {
      setError(rotateError instanceof Error ? rotateError.message : "Failed to rotate token");
    } finally {
      setBusyTokenId(null);
    }
  };

  const copyToken = async () => {
    if (!revealedToken) return;
    await navigator.clipboard.writeText(revealedToken);
    setCopied(true);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <KeyRound className="h-6 w-6 text-primary" />
            <div>
              <CardTitle>API Tokens</CardTitle>
              <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                Create an account-scoped token for a single Hermes MCP container.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {revealedToken && (
            <div className="rounded-lg border border-orange/40 bg-orange/10 p-4">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-orange" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-dark dark:text-white">Copy this token now</p>
                  <p className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                    It is shown only once. Set it as FINANCE_API_TOKEN in exactly one MCP container.
                  </p>
                  <code className="mt-3 block overflow-x-auto rounded bg-dark px-3 py-2 text-xs text-white">
                    {revealedToken}
                  </code>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" onClick={copyToken} leftIcon={<Copy className="h-4 w-4" />}>
                      {copied ? "Copied" : "Copy token"}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setRevealedToken(null)}>
                      Dismiss
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                Token name
              </label>
              <TextInput value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                Expires in days
              </label>
              <TextInput
                type="number"
                min="1"
                max="3650"
                value={expiresInDays}
                placeholder="Blank means never"
                onChange={(event) => setExpiresInDays(event.target.value)}
              />
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
              Scopes
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {API_TOKEN_SCOPES.map((scope) => (
                <label
                  key={scope}
                  className="flex items-center gap-2 rounded-lg border border-stroke px-3 py-2 text-sm text-dark dark:border-dark-3 dark:text-white"
                >
                  <Checkbox
                    checked={scopes.includes(scope)}
                    onChange={(checked) =>
                      setScopes((current) =>
                        checked ? [...current, scope] : current.filter((item) => item !== scope),
                      )
                    }
                  />
                  <span>{scope}</span>
                </label>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-red">{error}</p>}
          <Button onClick={handleCreate} isLoading={isCreating} disabled={!name.trim() || scopes.length === 0}>
            Generate API token
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Issued Tokens</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border border-stroke dark:border-dark-3">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-gray-1 text-xs uppercase tracking-wide text-dark-5 dark:bg-dark-3 dark:text-dark-6">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Scopes</th>
                  <th className="px-3 py-2">Last used</th>
                  <th className="px-3 py-2">Expires</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((token) => {
                  const expired = !!token.expiresAt && new Date(token.expiresAt) <= new Date();
                  const inactive = !!token.revokedAt || expired;
                  return (
                    <tr key={token.id} className="border-t border-stroke dark:border-dark-3">
                      <td className="px-3 py-3 font-medium text-dark dark:text-white">{token.name}</td>
                      <td className="max-w-sm px-3 py-3 text-xs text-dark-5 dark:text-dark-6">
                        {token.scopes.join(", ")}
                      </td>
                      <td className="px-3 py-3 text-dark-5 dark:text-dark-6">
                        {token.lastUsedAt ? formatDate(token.lastUsedAt) : "Never"}
                      </td>
                      <td className="px-3 py-3 text-dark-5 dark:text-dark-6">{formatDate(token.expiresAt)}</td>
                      <td className="px-3 py-3">
                        <span className={inactive ? "text-red" : "text-green"}>
                          {token.revokedAt ? "Revoked" : expired ? "Expired" : "Active"}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex gap-2">
                          {!inactive && (
                            <>
                              <Button
                                size="sm"
                                variant="secondary"
                                isLoading={busyTokenId === token.id}
                                onClick={() => handleRotate(token.id)}
                                leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
                              >
                                Rotate
                              </Button>
                              <Button
                                size="sm"
                                variant="danger"
                                disabled={busyTokenId === token.id}
                                onClick={() => handleRevoke(token.id)}
                              >
                                Revoke
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {tokens.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-5 text-center text-dark-5 dark:text-dark-6">
                      No API tokens have been issued.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
