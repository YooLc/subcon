"use client";
import { RefreshCw } from "lucide-react";

import { CodeEditor } from "@/components/code-editor";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ConfigResponse, Status } from "@/components/studio/types";

type ConfigPanelProps = {
  config: ConfigResponse | null;
  loading: boolean;
  onReload: () => Promise<void>;
  onStatus: (status: Status) => void;
};

export function ConfigPanel({ config, loading, onReload, onStatus }: ConfigPanelProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
      <Card className="animate-[fade-in_0.5s_ease_forwards]">
        <CardHeader>
          <CardTitle>Runtime Config</CardTitle>
          <CardDescription>Paths for pref and rulesets used by the service.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Pref Path
            </p>
            <p className="rounded-2xl bg-muted/40 px-3 py-2 text-xs">
              {config?.pref_path ?? "Loading..."}
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Schema Dir
            </p>
            <p className="rounded-2xl bg-muted/40 px-3 py-2 text-xs">
              {config?.schema_dir ?? "Loading..."}
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Managed Base URL
            </p>
            <p className="rounded-2xl bg-muted/40 px-3 py-2 text-xs">
              {config?.managed_base_url ?? "Not configured"}
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Rulesets
            </p>
            <div className="space-y-1">
              {config?.rulesets?.length ? (
                config.rulesets.map((rule) => (
                  <p key={rule} className="rounded-2xl bg-muted/40 px-3 py-2 text-xs">
                    {rule}
                  </p>
                ))
              ) : (
                <p className="rounded-2xl bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  No rulesets configured
                </p>
              )}
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button
            variant="subtle"
            onClick={() =>
              onReload().catch((err) =>
                onStatus({
                  kind: "error",
                  message: err instanceof Error ? err.message : "Refresh failed",
                })
              )
            }
            disabled={loading}
          >
            <RefreshCw className="h-4 w-4" />
            Refresh config
          </Button>
        </CardFooter>
      </Card>

      <Card className="animate-[fade-in_0.6s_ease_forwards]">
        <CardHeader>
          <CardTitle>pref.toml</CardTitle>
          <CardDescription>Read-only view; edit via the file editors.</CardDescription>
        </CardHeader>
        <CardContent>
          <CodeEditor
            value={config?.pref ?? ""}
            language="toml"
            readOnly
            height="440px"
            className="overflow-hidden rounded-2xl border border-border/60 bg-muted/30"
          />
        </CardContent>
      </Card>
    </div>
  );
}
