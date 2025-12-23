"use client";

import * as React from "react";
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

type LoginScreenProps = {
  defaultServerUrl: string;
  loading: boolean;
  error?: string | null;
  onSubmit: (serverUrl: string, token: string) => void;
};

export function LoginScreen({
  defaultServerUrl,
  loading,
  error,
  onSubmit,
}: LoginScreenProps) {
  const [serverUrl, setServerUrl] = React.useState(defaultServerUrl);
  const [token, setToken] = React.useState("");

  React.useEffect(() => {
    if (defaultServerUrl) {
      setServerUrl(defaultServerUrl);
    }
  }, [defaultServerUrl]);

  return (
    <div className="mx-auto w-full max-w-xl">
      <Card className="animate-[fade-in_0.5s_ease_forwards]">
        <CardHeader className="space-y-3">
          <CardTitle className="text-2xl">Get Started</CardTitle>
          <CardDescription>
            Connect to your Subcon server to manage profiles, rules, and schema mappings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit(serverUrl, token);
            }}
          >
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Server URL
              </p>
              <Input
                value={serverUrl}
                onChange={(event) => setServerUrl(event.target.value)}
                placeholder="http://127.0.0.1:25500"
                autoComplete="url"
              />
            </div>
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Access Token
              </p>
              <Input
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="api_access_token"
                type="password"
                autoComplete="current-password"
              />
              <p className="text-xs text-muted-foreground">
                Leave blank if api_access_token is not configured.
              </p>
            </div>
            {error && (
              <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-600">
                {error}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Connect
            </Button>
            <p className="text-xs text-muted-foreground">
              Credentials are stored locally in this browser. Use Logout to clear them.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
