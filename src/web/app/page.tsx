"use client";

import * as React from "react";
import {
  CloudCog,
  Copy,
  FileText,
  Layers3,
  AlertTriangle,
  RefreshCw,
  Rocket,
  ScrollText,
  Server,
  Settings2,
  TerminalSquare,
  TrendingUp,
  Users,
} from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CachePanel } from "@/components/studio/cache-panel";
import { ConfigPanel } from "@/components/studio/config-panel";
import { ControlPanel } from "@/components/studio/control-panel";
import { GroupsPanel } from "@/components/studio/groups-panel";
import { LoginScreen } from "@/components/studio/login-screen";
import { ProfilesPanel } from "@/components/studio/profiles-panel";
import { RulesPanel } from "@/components/studio/rules-panel";
import { SchemaPanel } from "@/components/studio/schema-panel";
import { SubscriptionPanel } from "@/components/studio/subscription-panel";
import {
  clearAuthConfig,
  fetchJson,
  normalizeServerUrl,
  readAuthConfig,
  writeAuthConfig,
  type AuthConfig,
} from "@/components/studio/api";
import type { ConfigResponse, Status } from "@/components/studio/types";
import { cn } from "@/lib/utils";

const TOKEN_LENGTH = 32;
const TOKEN_SETS = {
  upper: "ABCDEFGHJKLMNPQRSTUVWXYZ",
  lower: "abcdefghijkmnopqrstuvwxyz",
  digits: "23456789",
  symbols: "!@#$%^&*_-+=",
};

function randomIndex(max: number): number {
  if (max <= 0) {
    return 0;
  }
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0] % max;
  }
  return Math.floor(Math.random() * max);
}

function pickRandom(chars: string): string {
  return chars[randomIndex(chars.length)] ?? "";
}

function generateStrongToken(length = TOKEN_LENGTH): string {
  const targetLength = Math.max(length, 12);
  const { upper, lower, digits, symbols } = TOKEN_SETS;
  const all = `${upper}${lower}${digits}${symbols}`;
  const chars = [
    pickRandom(upper),
    pickRandom(lower),
    pickRandom(digits),
    pickRandom(symbols),
  ];
  for (let i = chars.length; i < targetLength; i += 1) {
    chars.push(pickRandom(all));
  }
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export default function Home() {
  const [status, setStatus] = React.useState<Status | null>(null);
  const [auth, setAuth] = React.useState<AuthConfig | null>(null);
  const [authReady, setAuthReady] = React.useState(false);
  const [authError, setAuthError] = React.useState<string | null>(null);
  const [authLoading, setAuthLoading] = React.useState(false);
  const [online, setOnline] = React.useState(false);
  const [config, setConfig] = React.useState<ConfigResponse | null>(null);
  const [tokenPromptOpen, setTokenPromptOpen] = React.useState(false);
  const [tokenPrompted, setTokenPrompted] = React.useState(false);
  const [suggestedToken, setSuggestedToken] = React.useState("");
  const [tokenSetting, setTokenSetting] = React.useState(false);
  const [tokenSettingError, setTokenSettingError] = React.useState<string | null>(null);
  const [tokenCopyStatus, setTokenCopyStatus] = React.useState<"idle" | "ok" | "error">(
    "idle"
  );
  const [tokenCopyMessage, setTokenCopyMessage] = React.useState("");
  const [loadingConfig, setLoadingConfig] = React.useState(false);
  const [showBackToTop, setShowBackToTop] = React.useState(false);
  const [defaultServerUrl, setDefaultServerUrl] = React.useState("");

  const pushStatus = React.useCallback((next: Status) => {
    setStatus(next);
  }, []);

  const regenerateToken = React.useCallback(() => {
    setSuggestedToken(generateStrongToken());
    setTokenSettingError(null);
  }, []);

  const applySuggestedToken = React.useCallback(async () => {
    if (!auth) {
      return;
    }
    const token = suggestedToken.trim();
    if (!token) {
      setTokenSettingError("Generated token is empty.");
      return;
    }
    setTokenSetting(true);
    setTokenSettingError(null);
    try {
      await fetchJson("/api/control/token", {
        method: "POST",
        body: JSON.stringify({ token }),
      });
      const nextAuth = { baseUrl: auth.baseUrl, token };
      writeAuthConfig(nextAuth);
      setAuth(nextAuth);
      setTokenPromptOpen(false);
      pushStatus({ kind: "ok", message: "api_access_token updated" });
    } catch (err) {
      setTokenSettingError(
        err instanceof Error ? err.message : "Failed to update api_access_token."
      );
    } finally {
      setTokenSetting(false);
    }
  }, [auth, pushStatus, suggestedToken]);

  const handleCopyToken = React.useCallback(async () => {
    const token = suggestedToken.trim();
    if (!token) {
      setTokenCopyStatus("error");
      setTokenCopyMessage("No token to copy.");
      return;
    }
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      setTokenCopyStatus("error");
      setTokenCopyMessage("Clipboard not available.");
      return;
    }
    try {
      await navigator.clipboard.writeText(token);
      setTokenCopyStatus("ok");
      setTokenCopyMessage("Copied to clipboard.");
    } catch {
      setTokenCopyStatus("error");
      setTokenCopyMessage("Failed to copy token.");
    }
  }, [suggestedToken]);

  const loadConfig = React.useCallback(async () => {
    setLoadingConfig(true);
    try {
      const data = await fetchJson<ConfigResponse>("/api/config");
      setConfig(data);
    } catch (err) {
      const statusCode =
        typeof err === "object" && err && "status" in err
          ? (err as { status?: number }).status
          : undefined;
      if (statusCode === 403) {
        clearAuthConfig();
        setAuth(null);
        setAuthError("Token expired or invalid. Please sign in again.");
        return;
      }
      pushStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to load config",
      });
    } finally {
      setLoadingConfig(false);
    }
  }, [pushStatus]);

  const checkPing = React.useCallback(async () => {
    if (!auth) {
      setOnline(false);
      return;
    }
    try {
      await fetchJson("/api/ping");
      setOnline(true);
    } catch (err) {
      const statusCode =
        typeof err === "object" && err && "status" in err
          ? (err as { status?: number }).status
          : undefined;
      setOnline(false);
      if (statusCode === 403) {
        clearAuthConfig();
        setAuth(null);
        setAuthError("Token expired or invalid. Please sign in again.");
      }
    }
  }, [auth]);

  React.useEffect(() => {
    if (typeof window !== "undefined") {
      setDefaultServerUrl(window.location.origin);
    }
  }, []);

  React.useEffect(() => {
    const stored = readAuthConfig();
    if (stored) {
      setAuth(stored);
    }
    setAuthReady(true);
  }, []);

  React.useEffect(() => {
    if (!auth) {
      setConfig(null);
      setOnline(false);
      return;
    }
    void loadConfig();
  }, [auth, loadConfig]);

  React.useEffect(() => {
    if (!auth || !config) {
      setTokenPromptOpen(false);
      setTokenPrompted(false);
      return;
    }
    if (config.api_auth_required) {
      setTokenPromptOpen(false);
      setTokenPrompted(false);
      return;
    }
    if (!tokenPrompted) {
      setSuggestedToken(generateStrongToken());
      setTokenSettingError(null);
      setTokenPromptOpen(true);
      setTokenPrompted(true);
    }
  }, [auth, config, tokenPrompted]);

  React.useEffect(() => {
    setTokenCopyStatus("idle");
    setTokenCopyMessage("");
  }, [suggestedToken, tokenPromptOpen]);

  React.useEffect(() => {
    if (tokenCopyStatus === "idle") {
      return;
    }
    const timer = window.setTimeout(() => {
      setTokenCopyStatus("idle");
      setTokenCopyMessage("");
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [tokenCopyStatus]);

  React.useEffect(() => {
    if (!auth) {
      return;
    }
    void checkPing();
    const id = window.setInterval(() => {
      void checkPing();
    }, 15000);
    return () => window.clearInterval(id);
  }, [auth, checkPing]);

  React.useEffect(() => {
    if (!status) {
      return;
    }
    const timer = window.setTimeout(() => setStatus(null), 5000);
    return () => window.clearTimeout(timer);
  }, [status]);

  React.useEffect(() => {
    const onScroll = () => {
      setShowBackToTop(window.scrollY > 500);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <TooltipProvider delayDuration={250}>
      <Dialog
        open={tokenPromptOpen}
        onOpenChange={(open) => {
          if (!open) {
            setTokenPromptOpen(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Secure your API</DialogTitle>
            <DialogDescription>
              <span className="inline-flex items-center gap-2 my-2">
                <AlertTriangle className="h-6 w-6 text-amber-500" />
                <span>
                  <span className="font-semibold">api_access_token is not configured.</span><br />
                  <span className="font-semibold">Set one now</span> to protect /api access.
                </span>
              </span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Generated token
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  value={suggestedToken}
                  readOnly
                  onFocus={(event) => event.currentTarget.select()}
                  className="sm:flex-1"
                />
                <div className="flex flex-wrap gap-2">
                  <Tooltip open={tokenCopyStatus !== "idle"}>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="subtle"
                        size="sm"
                        onClick={handleCopyToken}
                        disabled={tokenSetting}
                      >
                        <Copy className="h-4 w-4" />
                        Copy
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      {tokenCopyMessage || "Copy"}
                    </TooltipContent>
                  </Tooltip>
                  <Button
                    type="button"
                    variant="subtle"
                    size="sm"
                    onClick={regenerateToken}
                    disabled={tokenSetting}
                  >
                    <RefreshCw className="h-4 w-4" />
                    Regenerate
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Save this token securely. You will need it for future logins.
              </p>
            </div>
            {tokenSettingError && (
              <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-600">
                {tokenSettingError}
              </div>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setTokenPromptOpen(false)}
                disabled={tokenSetting}
              >
                Later
              </Button>
              <Button type="button" onClick={applySuggestedToken} disabled={tokenSetting}>
                {tokenSetting ? "Setting..." : "Set token & reload"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <div className="relative min-h-screen bg-background text-foreground">
        <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
          <div className="absolute -top-24 left-[6%] h-72 w-72 rounded-full bg-[radial-gradient(circle_at_center,rgba(20,184,166,0.35),transparent_70%)] blur-2xl animate-[drift_18s_ease-in-out_infinite]" />
          <div className="absolute top-[8%] right-[5%] h-80 w-80 rounded-full bg-[radial-gradient(circle_at_center,rgba(245,158,11,0.25),transparent_70%)] blur-3xl animate-[drift-alt_24s_ease-in-out_infinite]" />
          <div className="absolute top-[28%] left-[26%] h-64 w-64 rounded-full bg-[radial-gradient(circle_at_center,rgba(71,85,105,0.18),transparent_70%)] blur-2xl animate-[drift-slow_26s_ease-in-out_infinite]" />
          <div className="absolute top-[44%] right-[16%] h-72 w-72 rounded-full bg-[radial-gradient(circle_at_center,rgba(45,212,191,0.22),transparent_70%)] blur-3xl animate-[drift_30s_ease-in-out_infinite]" />
          <div className="absolute bottom-[28%] left-[10%] h-80 w-80 rounded-full bg-[radial-gradient(circle_at_center,rgba(56,189,248,0.2),transparent_70%)] blur-3xl animate-[drift-alt_28s_ease-in-out_infinite]" />
          <div className="absolute bottom-[12%] right-[24%] h-72 w-72 rounded-full bg-[radial-gradient(circle_at_center,rgba(148,163,184,0.18),transparent_70%)] blur-3xl animate-[drift-slow_34s_ease-in-out_infinite]" />
          <div className="absolute top-[62%] left-[54%] h-64 w-64 rounded-full bg-[radial-gradient(circle_at_center,rgba(94,234,212,0.18),transparent_70%)] blur-2xl animate-[drift_32s_ease-in-out_infinite]" />
          <div className="absolute top-[16%] left-[58%] h-60 w-60 rounded-full bg-[radial-gradient(circle_at_center,rgba(251,191,36,0.18),transparent_70%)] blur-3xl animate-[drift-alt_20s_ease-in-out_infinite]" />
        </div>

        <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 pb-16 pt-12">
          <header className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center justify-between gap-6">
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Rocket className="h-4 w-4" />
                  </span>
                  Subcon Studio
                </div>
                <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">
                  Control Panel
                </h1>
                <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
                  Edit profiles, rules, and schema mappings, then control reloads and restarts.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                {auth && (
                  <div className="flex items-center gap-2 rounded-full border border-border/60 bg-card/70 px-4 py-2 text-sm backdrop-blur">
                    <span className="text-muted-foreground">Status</span>
                    <Badge variant={online ? "success" : "warning"}>
                      {online ? "Online" : "Offline"}
                    </Badge>
                  </div>
                )}
                <ThemeToggle />
                {auth && (
                  <button
                    type="button"
                    onClick={() => {
                      clearAuthConfig();
                      setAuth(null);
                      setStatus(null);
                      setConfig(null);
                      setAuthError(null);
                      setOnline(false);
                    }}
                    className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/70 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground transition hover:text-foreground"
                  >
                    Logout
                  </button>
                )}
              </div>
            </div>

            {auth && (
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant="secondary">
                  <Server className="mr-2 h-3.5 w-3.5" />
                  {config ? `${config.server.listen}:${config.server.port}` : "Waiting"}
                </Badge>
                {config && <Badge variant="outline">v{config.version}</Badge>}
                {status && (
                  <Badge
                    variant={
                      status.kind === "ok"
                        ? "success"
                        : status.kind === "error"
                          ? "warning"
                          : "secondary"
                    }
                    className="max-w-full"
                  >
                    {status.message}
                  </Badge>
                )}
              </div>
            )}
          </header>

          {!authReady ? null : auth ? (
            <Tabs defaultValue="subscription" className="w-full">
              <div className="sticky top-4 z-40 -mx-2 px-2 pb-2">
                <TabsList className="flex flex-wrap gap-2 shadow-lg shadow-black/5">
                  <TabsTrigger value="subscription" className="gap-2">
                    <TerminalSquare className="h-4 w-4" />
                    Subscription
                  </TabsTrigger>
                  <TabsTrigger value="profiles" className="gap-2">
                    <FileText className="h-4 w-4" />
                    Profiles
                  </TabsTrigger>
                  <TabsTrigger value="rules" className="gap-2">
                    <ScrollText className="h-4 w-4" />
                    Rules
                  </TabsTrigger>
                  <TabsTrigger value="schema" className="gap-2">
                    <Layers3 className="h-4 w-4" />
                    Schema
                  </TabsTrigger>
                  <TabsTrigger value="groups" className="gap-2">
                    <Users className="h-4 w-4" />
                    Groups
                  </TabsTrigger>
                  <TabsTrigger value="cache" className="gap-2">
                    <TrendingUp className="h-4 w-4" />
                    Cache
                  </TabsTrigger>
                  <TabsTrigger value="config" className="gap-2">
                    <Settings2 className="h-4 w-4" />
                    Config
                  </TabsTrigger>
                  <TabsTrigger value="control" className="gap-2">
                    <CloudCog className="h-4 w-4" />
                    Control
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="subscription">
                <SubscriptionPanel config={config} />
              </TabsContent>

              <TabsContent value="profiles">
                <ProfilesPanel onStatus={pushStatus} />
              </TabsContent>

              <TabsContent value="rules">
                <RulesPanel onStatus={pushStatus} />
              </TabsContent>

              <TabsContent value="schema">
                <SchemaPanel onStatus={pushStatus} />
              </TabsContent>

              <TabsContent value="groups">
                <GroupsPanel onStatus={pushStatus} />
              </TabsContent>

              <TabsContent value="cache">
                <CachePanel onStatus={pushStatus} />
              </TabsContent>

              <TabsContent value="config">
                <ConfigPanel
                  config={config}
                  loading={loadingConfig}
                  onReload={loadConfig}
                  onStatus={pushStatus}
                />
              </TabsContent>

              <TabsContent value="control">
                <ControlPanel
                  onReload={async () => {
                    try {
                      await fetchJson("/api/control/reload", { method: "POST" });
                      pushStatus({ kind: "ok", message: "Configuration reloaded" });
                      await loadConfig();
                    } catch (err) {
                      pushStatus({
                        kind: "error",
                        message: err instanceof Error ? err.message : "Reload failed",
                      });
                    }
                  }}
                  onRestart={async () => {
                    try {
                      await fetchJson("/api/control/restart", { method: "POST" });
                      pushStatus({ kind: "info", message: "Restart requested" });
                    } catch (err) {
                      pushStatus({
                        kind: "error",
                        message: err instanceof Error ? err.message : "Restart failed",
                      });
                    }
                  }}
                />
              </TabsContent>
            </Tabs>
          ) : (
            <LoginScreen
              defaultServerUrl={defaultServerUrl}
              loading={authLoading}
              error={authError}
              onSubmit={async (serverUrl, token) => {
                const normalized = normalizeServerUrl(serverUrl);
                if (!normalized) {
                  setAuthError("Invalid server URL.");
                  return;
                }
                if (defaultServerUrl && normalized !== defaultServerUrl) {
                  setAuthError("Server URL must match this site for CSRF protection.");
                  return;
                }
                const trimmedToken = token.trim();
                setAuthLoading(true);
                setAuthError(null);
                const nextAuth = { baseUrl: normalized, token: trimmedToken };
                try {
                  await fetchJson<ConfigResponse>("/api/config", undefined, nextAuth);
                  writeAuthConfig(nextAuth);
                  setAuth(nextAuth);
                } catch (err) {
                  clearAuthConfig();
                  setAuth(null);
                  setAuthError(
                    err instanceof Error ? err.message : "Failed to connect."
                  );
                } finally {
                  setAuthLoading(false);
                }
              }}
            />
          )}
        </div>

        {auth && (
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className={cn(
              "fixed bottom-6 right-6 z-50 inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/80 px-4 py-2 text-xs font-semibold text-foreground shadow-lg shadow-black/10 backdrop-blur transition",
              showBackToTop
                ? "translate-y-0 opacity-100"
                : "pointer-events-none translate-y-3 opacity-0"
            )}
          >
            <Rocket className="h-4 w-4" />
            Back to top
          </button>
        )}
      </div>
    </TooltipProvider>
  );
}
