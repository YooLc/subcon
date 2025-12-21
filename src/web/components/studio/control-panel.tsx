"use client";

import * as React from "react";
import { Loader2, RefreshCw, Settings2, TerminalSquare } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fetchJson } from "@/components/studio/api";
import type { LogResponse } from "@/components/studio/types";

type ControlPanelProps = {
  onReload: () => Promise<void>;
  onRestart: () => Promise<void>;
};

export function ControlPanel({ onReload, onRestart }: ControlPanelProps) {
  const [reloading, setReloading] = React.useState(false);
  const [restarting, setRestarting] = React.useState(false);
  const [logs, setLogs] = React.useState<string[]>([]);
  const [loadingLogs, setLoadingLogs] = React.useState(false);

  const loadLogs = React.useCallback(async () => {
    setLoadingLogs(true);
    try {
      const data = await fetchJson<LogResponse>("/api/logs?limit=200");
      setLogs(data.items);
    } catch {
      setLogs(["Failed to load logs."]);
    } finally {
      setLoadingLogs(false);
    }
  }, []);

  React.useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="animate-[fade-in_0.5s_ease_forwards]">
        <CardHeader>
          <CardTitle>Reload Config</CardTitle>
          <CardDescription>Reload pref and schema definitions.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Use after schema edits to refresh without restarting.</p>
          <div className="rounded-2xl border border-border/60 bg-muted/40 px-4 py-3 text-xs">
            Reloads memory only; no files are written.
          </div>
        </CardContent>
        <CardFooter>
          <Button
            variant="secondary"
            onClick={() => {
              setReloading(true);
              onReload().finally(() => setReloading(false));
            }}
            disabled={reloading}
          >
            <RefreshCw className="h-4 w-4" />
            Reload now
          </Button>
        </CardFooter>
      </Card>

      <Card className="animate-[fade-in_0.6s_ease_forwards]">
        <CardHeader>
          <CardTitle>Restart Service</CardTitle>
          <CardDescription>Exit process to allow supervisor restart.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Best used with systemd or a docker restart policy.</p>
          <div className="rounded-2xl border border-border/60 bg-muted/40 px-4 py-3 text-xs">
            Process exits; ensure a supervisor restarts it.
          </div>
        </CardContent>
        <CardFooter>
          <Button
            variant="outline"
            onClick={() => {
              setRestarting(true);
              onRestart().finally(() => setRestarting(false));
            }}
            disabled={restarting}
          >
            <Settings2 className="h-4 w-4" />
            Request restart
          </Button>
        </CardFooter>
      </Card>

      <Card className="lg:col-span-2 animate-[fade-in_0.7s_ease_forwards]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TerminalSquare className="h-4 w-4 text-primary" />
            Live Logs
          </CardTitle>
          <CardDescription>Latest in-memory log lines.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">{logs.length} lines</p>
            <Button variant="subtle" onClick={() => void loadLogs()} disabled={loadingLogs}>
              {loadingLogs ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Refresh logs
            </Button>
          </div>
          <div className="max-h-72 overflow-auto rounded-2xl border border-border/60 bg-muted/40 p-4 text-xs text-muted-foreground">
            {logs.length === 0 ? (
              <p>No logs available.</p>
            ) : (
              logs.map((line, index) => <p key={`${index}-${line}`}>{line}</p>)
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
