"use client";

import * as React from "react";
import { Code2, LayoutGrid, Loader2, RefreshCw, Save, ScrollText } from "lucide-react";

import { CodeEditor } from "@/components/code-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fetchJson } from "@/components/studio/api";
import { languageForFile } from "@/components/studio/utils";
import type {
  FileContentResponse,
  FileEntry,
  FileListResponse,
  PanelProps,
  UpdateFileResponse,
} from "@/components/studio/types";

const SUPPORTED_RULE_TYPES = [
  "DOMAIN",
  "DOMAIN-SUFFIX",
  "DOMAIN-KEYWORD",
  "DOMAIN-WILDCARD",
  "DOMAIN-REGEX",
  "GEOSITE",
  "IP-CIDR",
  "IP-CIDR6",
  "IP-SUFFIX",
  "IP-ASN",
  "GEOIP",
  "SRC-GEOIP",
  "SRC-IP-ASN",
  "SRC-IP-CIDR",
  "SRC-IP-SUFFIX",
  "DST-PORT",
  "SRC-PORT",
  "IN-PORT",
  "IN-TYPE",
  "IN-USER",
  "IN-NAME",
  "PROCESS-PATH",
  "PROCESS-PATH-REGEX",
  "PROCESS-NAME",
  "PROCESS-NAME-REGEX",
  "UID",
  "NETWORK",
  "DSCP",
  "RULE-SET",
  "AND",
  "OR",
  "NOT",
  "SUB-RULE",
  "MATCH",
];

type RuleItem = {
  id: string;
  type: string;
  content: string;
  flags: string[];
  raw: string;
};

function parseRules(content: string): RuleItem[] {
  return content
    .split(/\r?\n/)
    .map(parseRuleLine)
    .filter((item): item is RuleItem => item !== null);
}

function parseRuleLine(line: string): RuleItem | null {
  const stripped = stripInlineComment(line);
  const trimmed = stripped.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }
  const parts = splitRuleParts(trimmed);
  if (parts.length === 0 || parts[0] === "") {
    return null;
  }
  const rawType = parts[0];
  if (!isSupportedRuleType(rawType)) {
    return null;
  }
  const type = rawType;
  const flags: string[] = [];
  const contentParts = parts.slice(1);

  while (contentParts.length > 0) {
    const last = contentParts[contentParts.length - 1].trim();
    if (last === "") {
      contentParts.pop();
      continue;
    }
    if (last.toLowerCase() === "no-resolve") {
      flags.push("no-resolve");
      contentParts.pop();
      continue;
    }
    break;
  }

  return {
    id: `${type}-${trimmed}`,
    type,
    content: contentParts.join(","),
    flags,
    raw: trimmed,
  };
}

function stripInlineComment(line: string): string {
  const idx = line.indexOf("//");
  if (idx >= 0) {
    return line.slice(0, idx);
  }
  return line;
}

function splitRuleParts(line: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (const ch of line) {
    if (ch === "(") {
      depth += 1;
      current += ch;
      continue;
    }
    if (ch === ")") {
      depth = Math.max(0, depth - 1);
      current += ch;
      continue;
    }
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current.trim());
  return parts;
}

function isSupportedRuleType(ruleType: string): boolean {
  return SUPPORTED_RULE_TYPES.includes(ruleType.toUpperCase());
}

export function RulesPanel({ onStatus }: PanelProps) {
  const [items, setItems] = React.useState<FileEntry[]>([]);
  const [selectedName, setSelectedName] = React.useState<string | null>(null);
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const [content, setContent] = React.useState("");
  const [mode, setMode] = React.useState<"friendly" | "code">("friendly");
  const [dirty, setDirty] = React.useState(false);
  const [loadingList, setLoadingList] = React.useState(false);
  const [loadingItem, setLoadingItem] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const selectedNameRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    selectedNameRef.current = selectedName;
  }, [selectedName]);

  const loadItem = React.useCallback(
    async (name: string) => {
      setLoadingItem(true);
      setSelectedName(name);
      try {
        const data = await fetchJson<FileContentResponse>(
          `/api/rules/${encodeURIComponent(name)}`
        );
        setSelectedPath(data.path);
        setContent(data.content);
        setDirty(false);
      } catch (err) {
        onStatus({
          kind: "error",
          message: err instanceof Error ? err.message : "Read failed",
        });
      } finally {
        setLoadingItem(false);
      }
    },
    [onStatus]
  );

  const loadList = React.useCallback(async () => {
    setLoadingList(true);
    try {
      const data = await fetchJson<FileListResponse>("/api/rules");
      setItems(data.items);
      const currentSelection = selectedNameRef.current;
      if (!currentSelection && data.items[0]) {
        await loadItem(data.items[0].name);
      } else if (
        currentSelection &&
        !data.items.find((item) => item.name === currentSelection)
      ) {
        if (data.items[0]) {
          await loadItem(data.items[0].name);
        } else {
          setSelectedName(null);
          setSelectedPath(null);
          setContent("");
          setDirty(false);
        }
      }
    } catch (err) {
      onStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to load list",
      });
    } finally {
      setLoadingList(false);
    }
  }, [loadItem, onStatus]);

  React.useEffect(() => {
    void loadList();
  }, [loadList]);

  const handleSave = React.useCallback(async () => {
    if (!selectedName) {
      return;
    }
    setSaving(true);
    try {
      await fetchJson<UpdateFileResponse>(
        `/api/rules/${encodeURIComponent(selectedName)}`,
        {
          method: "PUT",
          body: JSON.stringify({ content }),
        }
      );
      setDirty(false);
      onStatus({ kind: "ok", message: `${selectedName} saved` });
    } catch (err) {
      onStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Save failed",
      });
    } finally {
      setSaving(false);
    }
  }, [content, onStatus, selectedName]);

  const ruleItems = React.useMemo(() => parseRules(content), [content]);

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <Card className="animate-[fade-in_0.5s_ease_forwards]">
        <CardHeader>
          <CardTitle>Rules</CardTitle>
          <CardDescription>Rule files referenced by the rulesets.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {items.length === 0 && !loadingList && (
            <div className="rounded-2xl border border-dashed border-border/60 bg-muted/40 px-4 py-6 text-sm text-muted-foreground">
              No rule files found.
            </div>
          )}
          <div className="space-y-2">
            {items.map((item) => {
              const isActive = item.name === selectedName;
              return (
                <button
                  key={item.name}
                  onClick={() => void loadItem(item.name)}
                  className={cn(
                    "flex w-full flex-col gap-2 rounded-2xl border px-4 py-3 text-left text-sm transition",
                    isActive
                      ? "border-primary/60 bg-primary/10 text-foreground"
                      : "border-border/50 bg-background/60 hover:border-primary/40"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{item.name}</span>
                    {dirty && isActive && (
                      <Badge variant="warning" className="shrink-0">
                        Unsaved
                      </Badge>
                    )}
                  </div>
                  <span className="truncate text-xs text-muted-foreground">
                    {item.path}
                  </span>
                </button>
              );
            })}
          </div>
        </CardContent>
        <CardFooter>
          <Button
            variant="subtle"
            onClick={() => void loadList()}
            disabled={loadingList}
          >
            {loadingList ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh list
          </Button>
        </CardFooter>
      </Card>

      <Card className="animate-[fade-in_0.6s_ease_forwards]">
        <CardHeader className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ScrollText className="h-4 w-4 text-primary" />
                {selectedName ?? "Select a file"}
              </CardTitle>
              <CardDescription className="truncate">
                {selectedPath ?? "File path appears here"}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant={mode === "friendly" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setMode("friendly")}
              >
                <LayoutGrid className="h-4 w-4" />
                Friendly
              </Button>
              <Button
                variant={mode === "code" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setMode("code")}
              >
                <Code2 className="h-4 w-4" />
                Editor
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {mode === "friendly" ? (
            <div className="space-y-2">
              {ruleItems.length === 0 && (
                <div className="rounded-2xl border border-dashed border-border/60 bg-muted/40 px-4 py-6 text-sm text-muted-foreground">
                  No rules in this file.
                </div>
              )}
              {ruleItems.map((rule) => (
                <div
                  key={rule.id}
                  className="flex flex-wrap items-center gap-3 rounded-2xl border border-border/50 bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
                >
                  <Badge variant="secondary">{rule.type}</Badge>
                  {rule.flags.map((flag) => (
                    <Badge key={`${rule.id}-${flag}`} variant="outline">
                      {flag}
                    </Badge>
                  ))}
                  <span className="truncate text-foreground/80">
                    {rule.content || rule.raw}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <CodeEditor
              value={content}
              language={languageForFile(selectedName ?? "")}
              onChange={(value) => {
                setContent(value);
                setDirty(true);
              }}
            />
          )}
        </CardContent>
        <CardFooter className="flex flex-wrap gap-3">
          <Button
            onClick={handleSave}
            disabled={!selectedName || saving || loadingItem}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save
          </Button>
          <Button
            variant="outline"
            onClick={() => selectedName && void loadItem(selectedName)}
            disabled={!selectedName || loadingItem}
          >
            <RefreshCw className="h-4 w-4" />
            Reload
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
