"use client";

import * as React from "react";
import { BadgeCheck, Loader2, RefreshCw } from "lucide-react";

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
import type { GroupEntry, GroupResponse, PanelProps } from "@/components/studio/types";

export function GroupsPanel({ onStatus }: PanelProps) {
  const [groups, setGroups] = React.useState<GroupEntry[]>([]);
  const [loading, setLoading] = React.useState(false);

  const loadGroups = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchJson<GroupResponse>("/api/groups");
      setGroups(data.items);
    } catch (err) {
      onStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to load groups",
      });
    } finally {
      setLoading(false);
    }
  }, [onStatus]);

  React.useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  return (
    <Card className="animate-[fade-in_0.5s_ease_forwards]">
      <CardHeader>
        <CardTitle>Groups</CardTitle>
        <CardDescription>Proxy groups and their rulesets.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">{groups.length} groups loaded</p>
          <Button variant="subtle" onClick={() => void loadGroups()} disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh
          </Button>
        </div>
        {groups.length === 0 && !loading && (
          <div className="rounded-2xl border border-dashed border-border/60 bg-muted/40 px-4 py-6 text-sm text-muted-foreground">
            No groups found.
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          {groups.map((group) => (
            <div
              key={group.name}
              className="rounded-3xl border border-border/50 bg-card/60 p-5 shadow-sm backdrop-blur"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-base font-semibold">{group.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Type: {group.group_type}
                  </p>
                </div>
                <Badge variant="secondary">
                  <BadgeCheck className="mr-1 h-3.5 w-3.5" />
                  {group.rules.length} rules
                </Badge>
              </div>
              <div className="mt-4 space-y-2 text-xs text-muted-foreground">
                {group.rulesets.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {group.rulesets.map((ruleset, idx) => (
                      <Badge key={`${group.name}-${idx}`} variant="outline">
                        {ruleset}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p>No rulesets mapped.</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
