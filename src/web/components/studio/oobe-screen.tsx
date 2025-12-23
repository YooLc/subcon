"use client";

import * as React from "react";
import { AlertTriangle, Eye, EyeOff, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type OobeScreenProps = {
  baseUrl: string;
  token: string;
  loading: boolean;
  error?: string | null;
  onTokenChange: (value: string) => void;
  onGenerate: () => void;
  onSubmit: () => void;
};

export function OobeScreen({
  baseUrl,
  token,
  loading,
  error,
  onTokenChange,
  onGenerate,
  onSubmit,
}: OobeScreenProps) {
  const [showToken, setShowToken] = React.useState(false);
  const [generatePulse, setGeneratePulse] = React.useState(false);

  const handleGenerate = React.useCallback(() => {
    setGeneratePulse(true);
    onGenerate();
  }, [onGenerate]);

  React.useEffect(() => {
    if (!generatePulse) {
      return;
    }
    const timer = window.setTimeout(() => setGeneratePulse(false), 700);
    return () => window.clearTimeout(timer);
  }, [generatePulse]);

  return (
    <div className="mx-auto w-full max-w-xl">
      <Card className="animate-[fade-in_0.5s_ease_forwards]">
        <CardHeader className="space-y-3">
          <CardTitle className="text-2xl">Secure your API</CardTitle>
          <CardDescription>
            <span className="inline-flex items-center gap-2 text-amber-600">
              <AlertTriangle className="h-4 w-4" />
              api_access_token is not configured.
            </span>{" "}
            Set one now to protect /api access.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit();
            }}
          >
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Server URL
              </p>
              <Input value={baseUrl} readOnly />
            </div>
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Access Token
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative sm:flex-1">
                  <Input
                    value={token}
                    onChange={(event) => onTokenChange(event.target.value)}
                    placeholder="api_access_token"
                    type={showToken ? "text" : "password"}
                    name="api_access_token"
                    autoComplete="new-password"
                    className="pr-12"
                  />
                  <button
                    type="button"
                    aria-label={showToken ? "Hide token" : "Show token"}
                    aria-pressed={showToken}
                    onClick={() => setShowToken((prev) => !prev)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-2 text-muted-foreground transition hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
                  >
                    {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <Button type="button" variant="subtle" onClick={handleGenerate} disabled={loading}>
                  <RefreshCw className={generatePulse ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                  Generate
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Save this token securely. You will need it for future logins.
              </p>
            </div>
            {error && (
              <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-600">
                {error}
              </div>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="submit" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Set token & continue
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
