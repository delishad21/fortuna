"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { chatApi, Connection, DeviceLogin } from "@/lib/chat/client";
export function ConnectionPanel() {
  const [connections, setConnections] = useState<Connection[]>([]),
    [key, setKey] = useState(""),
    [login, setLogin] = useState<DeviceLogin | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const refresh = () => chatApi<Connection[]>("/settings").then(setConnections);
  useEffect(() => {
    void refresh().catch((e) => setMessage(e.message));
  }, []);
  useEffect(() => {
    if (!login || login.status !== "pending") return;
    const timer = setInterval(() => {
      void chatApi<DeviceLogin>(`/connections/codex/login/${login.loginId}`)
        .then((value) => {
          setLogin(value);
          if (value.status === "connected") {
            setMessage("Codex sign-in completed.");
            void refresh();
          }
        })
        .catch((e) => setMessage(e.message));
    }, 3000);
    return () => clearInterval(timer);
  }, [login?.loginId, login?.status]);
  async function act(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-6" aria-labelledby="ai-heading">
      <div>
        <h2
          id="ai-heading"
          className="text-xl font-semibold text-dark dark:text-white"
        >
          AI connection
        </h2>
        <p className="mt-2 text-sm text-dark-5 dark:text-dark-6">
          Connect a provider for your Fortuna account. Messages and attached
          statement content are sent to the selected provider. Changing
          providers applies to future messages; conversation history is
          retained.
        </p>
      </div>
      {message && (
        <p
          role="status"
          className="rounded-lg border border-stroke p-3 dark:border-stroke-dark"
        >
          {message}
        </p>
      )}
      {(["codex", "openrouter"] as const).map((provider) => {
        const connection = connections.find((c) => c.provider === provider);
        return (
          <div
            key={provider}
            className="space-y-4 rounded-xl border border-stroke bg-white p-5 dark:border-stroke-dark dark:bg-gray-dark"
          >
            <div className="flex flex-wrap justify-between gap-2">
              <div>
                <h3 className="font-semibold text-dark dark:text-white">
                  {provider === "codex" ? "Codex" : "OpenRouter"}
                </h3>
                <p className="text-sm text-dark-5 dark:text-dark-6">
                  {provider === "codex"
                    ? "GPT-6 Luna · Max reasoning"
                    : "GPT-6 Luna Pro"}
                </p>
              </div>
              <span className="text-sm">
                {connection?.selected ? "Selected · " : ""}
                {connection?.status || "Not connected"}
              </span>
            </div>
            {provider === "openrouter" && (
              <label className="block text-sm">
                API key{" "}
                {connection?.keyHint && (
                  <span>· saved key ends in {connection.keyHint}</span>
                )}
                <input
                  type="password"
                  autoComplete="off"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="Enter your OpenRouter API key"
                  className="mt-2 w-full rounded-lg border border-stroke bg-transparent p-3 dark:border-stroke-dark"
                />
              </label>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy || (provider === "openrouter" && !key.trim())}
                onClick={() =>
                  void act(async () => {
                    if (provider === "codex")
                      setLogin(
                        await chatApi("/connections/codex/start", {
                          method: "POST",
                          body: {},
                        }),
                      );
                    else {
                      await chatApi("/settings", {
                        method: "PUT",
                        body: { provider, key },
                      });
                      setKey("");
                      setMessage(
                        "Key saved. Test the connection before sending a message.",
                      );
                    }
                  })
                }
              >
                {provider === "codex" ? "Sign in with Codex" : "Save API key"}
              </Button>
              {connection && (
                <>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        const result = await chatApi(
                          `/connections/${provider}/test`,
                          { method: "POST", body: {} },
                        );
                        setMessage(
                          result.connected && result.modelAvailable
                            ? "Connection ready."
                            : result.error ||
                                "The requested model is unavailable. Reconnect or check provider access.",
                        );
                      })
                    }
                  >
                    Test connection
                  </Button>
                  {!connection.selected && (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() =>
                        void act(() =>
                          chatApi("/settings", {
                            method: "PUT",
                            body: { provider },
                          }),
                        )
                      }
                    >
                      Use {provider === "codex" ? "Codex" : "OpenRouter"}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await chatApi(`/connections/${provider}/disconnect`, {
                          method: "POST",
                          body: {},
                        });
                        if (provider === "codex") setLogin(null);
                        setMessage(
                          "Disconnected. Active work stopped; saved data is preserved.",
                        );
                      })
                    }
                  >
                    Disconnect
                  </Button>
                </>
              )}
            </div>
            {provider === "codex" && login && (
              <div className="space-y-2 border-l-2 border-primary pl-4">
                <p>Enter this code on the Codex sign-in page:</p>
                <p className="select-all font-mono text-xl font-semibold">
                  {login.userCode}
                </p>
                <a
                  className="text-primary underline"
                  href={login.verificationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open Codex sign-in
                </a>
                <p className="text-sm">
                  {login.status} · expires{" "}
                  {new Date(login.expiresAt).toLocaleTimeString()}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
