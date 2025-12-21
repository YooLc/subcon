"use client";

import * as React from "react";
import { Loader2, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fetchJson } from "@/components/studio/api";
import { formatDuration } from "@/components/studio/utils";
import type { CacheEntry, CacheResponse, PanelProps } from "@/components/studio/types";

export function CachePanel({ onStatus }: PanelProps) {
  const [items, setItems] = React.useState<CacheEntry[]>([]);
  const [loading, setLoading] = React.useState(false);

  const loadCache = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchJson<CacheResponse>("/api/cache");
      setItems(data.items);
    } catch (err) {
      onStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to load cache",
      });
    } finally {
      setLoading(false);
    }
  }, [onStatus]);

  React.useEffect(() => {
    void loadCache();
  }, [loadCache]);

  return (
    <Card className="animate-[fade-in_0.5s_ease_forwards]">
      <CardHeader>
        <CardTitle>Cache</CardTitle>
        <CardDescription>Active network cache entries and TTL.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">{items.length} entries</p>
          <Button variant="subtle" onClick={() => void loadCache()} disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh
          </Button>
        </div>
        {items.length === 0 && !loading && (
          <div className="rounded-2xl border border-dashed border-border/60 bg-muted/40 px-4 py-6 text-sm text-muted-foreground">
            No cache entries available.
          </div>
        )}
        <div className="space-y-3">
          {items.map((entry) => (
            <div
              key={entry.url}
              className="rounded-2xl border border-border/50 bg-card/60 px-4 py-3 text-xs text-muted-foreground backdrop-blur"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-foreground">{entry.url}</span>
                <Badge variant="secondary">{formatDuration(entry.ttl_seconds)}</Badge>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
