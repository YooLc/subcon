"use client";

import * as React from "react";
import YAML from "yaml";
import {
  Code2,
  Hash,
  LayoutGrid,
  Loader2,
  Pencil,
  RefreshCw,
  Save,
  Server,
  Tag,
} from "lucide-react";

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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { fetchJson } from "@/components/studio/api";
import { languageForFile } from "@/components/studio/utils";
import type {
  FileContentResponse,
  FileEntry,
  FileListResponse,
  PanelProps,
  ProfileState,
  ProxyField,
  ProxyFieldKind,
  ProxyItem,
  UpdateFileResponse,
} from "@/components/studio/types";

const COMMON_PROXY_TYPES = [
  "ss",
  "vmess",
  "vless",
  "trojan",
  "hysteria2",
  "wireguard",
  "socks5",
  "http",
  "snell",
  "tuic",
  "ssh",
];

function detectFieldKind(value: unknown): ProxyFieldKind {
  if (value === null || value === undefined) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  switch (typeof value) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "object":
      return "object";
    default:
      return "string";
  }
}

function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    const serialized = YAML.stringify(value, { indent: 2 }).trim();
    return serialized.replace(/\n+/g, " ");
  } catch {
    return String(value);
  }
}

function parseProfile(content: string): ProfileState {
  const data = (YAML.parse(content) ?? {}) as Record<string, unknown>;
  const rawProxies = Array.isArray(data.proxies) ? data.proxies : [];
  const proxies: ProxyItem[] = rawProxies.map((proxy, index) => {
    const item = (proxy ?? {}) as Record<string, unknown>;
    const keys = Object.keys(item);
    const name = String(item.name ?? `Proxy ${index + 1}`);
    const type = String(item.type ?? "unknown");
    const server = item.server ? String(item.server) : "";
    const port = item.port !== undefined ? String(item.port) : "";
    const fields = keys
      .filter((key) => !["name", "type", "server", "port"].includes(key))
      .map((key) => {
        const value = item[key];
        const kind = detectFieldKind(value);
        const editable =
          kind === "string" || kind === "number" || kind === "boolean" || kind === "null";
        return {
          key,
          kind,
          value,
          raw: formatFieldValue(value),
          editable,
        };
      });
    return {
      id: `${index}-${name}`,
      name,
      type,
      server,
      port,
      fields,
    };
  });

  const { proxies: _ignored, ...base } = data;
  return { base, proxies };
}

function buildProfileYaml(state: ProfileState): string {
  const proxies = state.proxies.map((proxy) => {
    const output: Record<string, unknown> = {
      name: proxy.name,
      type: proxy.type,
      server: proxy.server,
      port: parsePort(proxy.port),
    };
    proxy.fields.forEach((field) => {
      output[field.key] = parseFieldValue(field);
    });
    return output;
  });

  const output: Record<string, unknown> = {
    proxies,
    ...state.base,
  };

  return YAML.stringify(output, { indent: 2 });
}

function parsePort(raw: string): number | string {
  const num = Number(raw);
  if (Number.isFinite(num)) {
    return num;
  }
  return raw;
}

function parseFieldValue(field: ProxyField): unknown {
  if (!field.editable) {
    return field.value;
  }
  const raw = field.raw;
  switch (field.kind) {
    case "number": {
      const num = Number(raw);
      return Number.isFinite(num) ? num : raw;
    }
    case "boolean":
      if (raw.toLowerCase() === "true") {
        return true;
      }
      if (raw.toLowerCase() === "false") {
        return false;
      }
      return raw;
    case "null":
      return raw === "" ? null : raw;
    default:
      return raw;
  }
}

export function ProfilesPanel({ onStatus }: PanelProps) {
  const [items, setItems] = React.useState<FileEntry[]>([]);
  const [selectedName, setSelectedName] = React.useState<string | null>(null);
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const [content, setContent] = React.useState("");
  const [profileState, setProfileState] = React.useState<ProfileState | null>(null);
  const [mode, setMode] = React.useState<"friendly" | "code">("friendly");
  const [dirty, setDirty] = React.useState(false);
  const [loadingList, setLoadingList] = React.useState(false);
  const [loadingItem, setLoadingItem] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [parseError, setParseError] = React.useState<string | null>(null);
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
          `/api/profiles/${encodeURIComponent(name)}`
        );
        setSelectedPath(data.path);
        setContent(data.content);
        setParseError(null);
        try {
          const parsed = parseProfile(data.content);
          setProfileState(parsed);
        } catch (err) {
          setProfileState(null);
          setParseError(
            err instanceof Error ? err.message : "Failed to parse YAML"
          );
        }
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
      const data = await fetchJson<FileListResponse>("/api/profiles");
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
          setProfileState(null);
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

  const typeOptions = React.useMemo(() => {
    const fromProxies = profileState?.proxies.map((proxy) => proxy.type) ?? [];
    return Array.from(new Set([...COMMON_PROXY_TYPES, ...fromProxies])).filter(Boolean);
  }, [profileState]);

  const updateProxy = React.useCallback(
    (proxyId: string, updater: (proxy: ProxyItem) => ProxyItem) => {
      setProfileState((prev) => {
        if (!prev) {
          return prev;
        }
        return {
          ...prev,
          proxies: prev.proxies.map((proxy) =>
            proxy.id === proxyId ? updater(proxy) : proxy
          ),
        };
      });
      setDirty(true);
    },
    []
  );

  const handleSave = React.useCallback(async () => {
    if (!selectedName) {
      return;
    }
    setSaving(true);
    try {
      const payload =
        mode === "code"
          ? content
          : profileState
            ? buildProfileYaml(profileState)
            : content;
      await fetchJson<UpdateFileResponse>(
        `/api/profiles/${encodeURIComponent(selectedName)}`,
        {
          method: "PUT",
          body: JSON.stringify({ content: payload }),
        }
      );
      setContent(payload);
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
  }, [content, mode, onStatus, profileState, selectedName]);

  const switchMode = React.useCallback(
    (next: "friendly" | "code") => {
      if (next === mode) {
        return;
      }
      if (next === "code" && profileState) {
        const yaml = buildProfileYaml(profileState);
        setContent(yaml);
      }
      if (next === "friendly") {
        try {
          const parsed = parseProfile(content);
          setProfileState(parsed);
          setParseError(null);
        } catch (err) {
          setParseError(
            err instanceof Error ? err.message : "Failed to parse YAML"
          );
        }
      }
      setMode(next);
    },
    [content, mode, profileState]
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <Card className="animate-[fade-in_0.5s_ease_forwards]">
        <CardHeader>
          <CardTitle>Profiles</CardTitle>
          <CardDescription>
            Subscription sources with insert and default paths.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {items.length === 0 && !loadingList && (
            <div className="rounded-2xl border border-dashed border-border/60 bg-muted/40 px-4 py-6 text-sm text-muted-foreground">
              No profiles found.
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
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {item.usage && item.usage.length > 0 ? (
                      item.usage.map((usage) => (
                        <Badge key={usage} variant="secondary">
                          {usage}
                        </Badge>
                      ))
                    ) : (
                      <span className="truncate">{item.path}</span>
                    )}
                  </div>
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
                <LayoutGrid className="h-4 w-4 text-primary" />
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
                onClick={() => switchMode("friendly")}
              >
                <LayoutGrid className="h-4 w-4" />
                Friendly
              </Button>
              <Button
                variant={mode === "code" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => switchMode("code")}
              >
                <Code2 className="h-4 w-4" />
                Editor
              </Button>
            </div>
          </div>
          {parseError && (
            <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-600">
              {parseError}
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {mode === "friendly" ? (
            <div className="space-y-4">
              {profileState?.proxies.map((proxy) => (
                <ProxyCard
                  key={proxy.id}
                  proxy={proxy}
                  typeOptions={typeOptions}
                  onChange={(next) => updateProxy(proxy.id, () => next)}
                />
              ))}
              {profileState && profileState.proxies.length === 0 && (
                <div className="rounded-2xl border border-dashed border-border/60 bg-muted/40 px-4 py-6 text-sm text-muted-foreground">
                  No proxies found in this profile.
                </div>
              )}
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

type ProxyCardProps = {
  proxy: ProxyItem;
  typeOptions: string[];
  onChange: (proxy: ProxyItem) => void;
};

function ProxyCard({ proxy, typeOptions, onChange }: ProxyCardProps) {
  const [editingName, setEditingName] = React.useState(false);

  const updateField = (key: string, value: string) => {
    onChange({
      ...proxy,
      fields: proxy.fields.map((field) =>
        field.key === key ? { ...field, raw: value } : field
      ),
    });
  };

  return (
    <div className="rounded-3xl border border-border/50 bg-card/60 p-5 shadow-sm backdrop-blur">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          {editingName ? (
            <Input
              value={proxy.name}
              onChange={(event) => onChange({ ...proxy, name: event.target.value })}
              onBlur={() => setEditingName(false)}
              className="h-9 max-w-xs"
              autoFocus
            />
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setEditingName(true)}
                  className="group flex items-center gap-2 text-lg font-semibold"
                >
                  {proxy.name}
                  <Pencil className="h-4 w-4 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Click to edit name</TooltipContent>
            </Tooltip>
          )}
        </div>
        <Dialog>
          <DialogTrigger asChild>
            <button className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-foreground transition hover:bg-muted/70">
              <Tag className="h-3.5 w-3.5" />
              {proxy.type}
            </button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Proxy Type</DialogTitle>
              <DialogDescription>Pick a protocol type.</DialogDescription>
            </DialogHeader>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {typeOptions.map((option) => (
                <button
                  key={option}
                  onClick={() => onChange({ ...proxy, type: option })}
                  className={cn(
                    "rounded-2xl border px-3 py-2 text-left text-sm transition",
                    option === proxy.type
                      ? "border-primary/60 bg-primary/10 text-primary"
                      : "border-border/60 bg-background/50 hover:border-primary/40"
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <Server className="h-3.5 w-3.5" />
            Server
          </div>
          <Input
            value={proxy.server}
            onChange={(event) => onChange({ ...proxy, server: event.target.value })}
            placeholder="example.com"
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <Hash className="h-3.5 w-3.5" />
            Port
          </div>
          <Input
            value={proxy.port}
            onChange={(event) => onChange({ ...proxy, port: event.target.value })}
            placeholder="443"
          />
        </div>

        {proxy.fields.map((field) => (
          <div key={field.key} className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <span className="uppercase tracking-wide">{field.key}</span>
              {!field.editable && (
                <Badge variant="outline" className="text-[10px]">
                  Code only
                </Badge>
              )}
            </div>
            {field.editable ? (
              <Input
                value={field.raw}
                onChange={(event) => updateField(field.key, event.target.value)}
              />
            ) : (
              <div className="rounded-2xl border border-border/50 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {formatFieldValue(field.value)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
