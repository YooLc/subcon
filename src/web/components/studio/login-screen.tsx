"use client";

import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type LoginStep = "server" | "token";

type LoginScreenProps = {
  step: LoginStep;
  serverUrl: string;
  token: string;
  loading: boolean;
  error?: string | null;
  onServerUrlChange: (value: string) => void;
  onTokenChange: (value: string) => void;
  onNext: () => void;
  onLogin: () => void;
  onBack?: () => void;
};

export function LoginScreen({
  step,
  serverUrl,
  token,
  loading,
  error,
  onServerUrlChange,
  onTokenChange,
  onNext,
  onLogin,
  onBack,
}: LoginScreenProps) {
  const isTokenStep = step === "token";
  return (
    <div className="mx-auto w-full max-w-xl">
      <Card className="animate-[fade-in_0.5s_ease_forwards]">
        <CardHeader className="space-y-3">
          <CardTitle className="text-2xl">
            {isTokenStep ? "Enter Access Token" : "Get Started"}
          </CardTitle>
          <CardDescription>
            {isTokenStep
              ? "This server requires an access token to continue."
              : "Connect to your Subcon server to manage profiles, rules, and schema mappings."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (isTokenStep) {
                onLogin();
              } else {
                onNext();
              }
            }}
          >
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Server URL
              </p>
              {isTokenStep ? (
                <Input value={serverUrl} readOnly />
              ) : (
                <Input
                  value={serverUrl}
                  onChange={(event) => onServerUrlChange(event.target.value)}
                  placeholder="http://127.0.0.1:25500"
                  autoComplete="url"
                />
              )}
            </div>
            {isTokenStep && (
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Access Token
                </p>
                <Input
                  value={token}
                  onChange={(event) => onTokenChange(event.target.value)}
                  placeholder="api_access_token"
                  type="password"
                  name="api_access_token"
                  autoComplete="current-password"
                />
              </div>
            )}
            {error && (
              <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-600">
                {error}
              </div>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {isTokenStep && onBack && (
                <Button type="button" variant="ghost" onClick={onBack} disabled={loading}>
                  Back
                </Button>
              )}
              <Button type="submit" className="sm:min-w-[140px]" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {isTokenStep ? "Connect" : "Next"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Credentials are stored locally in this browser. Use Logout to clear them.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
