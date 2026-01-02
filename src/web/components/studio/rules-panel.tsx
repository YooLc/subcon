"use client";

import * as React from "react";
import {
  Code2,
  GripVertical,
  LayoutGrid,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ScrollText,
  Trash2,
} from "lucide-react";

import { CodeEditor } from "@/components/code-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
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
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { fetchJson } from "@/components/studio/api";
import { useConfirmDialog } from "@/components/studio/confirm-dialog";
import { isFileNonEmpty, languageForFile } from "@/components/studio/utils";
import type {
  DeleteFileResponse,
  FileContentResponse,
  FileEntry,
  FileListResponse,
  PanelProps,
  RenameFileResponse,
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

const SUPPORTED_RULE_FLAGS = ["no-resolve"];
const RULE_FILE_EXTS = ["list", "yaml", "yml"];
const DEFAULT_RULE_EXTENSION = "yaml";

type RuleItem = {
  id: string;
  index: number;
  type: string;
  content: string;
  flags: string[];
  raw: string;
};

type ParsedRules = {
  items: RuleItem[];
  indices: number[];
  lines: string[];
};

function parseRuleLines(content: string): ParsedRules {
  const lines = content.split(/\r?\n/);
  const items: RuleItem[] = [];
  const indices: number[] = [];
  lines.forEach((line, index) => {
    const parsed = parseRuleLine(line);
    if (parsed) {
      const contentKey = parsed.content ? parsed.content.replace(/\s+/g, " ") : "";
      items.push({
        ...parsed,
        index,
        id: `rule-${index}-${parsed.type}-${contentKey}-${parsed.flags.join("-")}`,
      });
      indices.push(index);
    }
  });
  return { items, indices, lines };
}

function parseRuleLine(
  line: string
): Omit<RuleItem, "id" | "index"> | null {
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

function buildRuleLine(rule: RuleItem): string {
  const parts: string[] = [rule.type];
  if (rule.content.trim() !== "") {
    parts.push(rule.content.trim());
  }
  if (rule.flags.includes("no-resolve")) {
    parts.push("no-resolve");
  }
  return parts.join(",");
}

function applyRuleOrder(parsed: ParsedRules, ordered: RuleItem[]): string {
  if (parsed.indices.length === 0) {
    return ordered.map(buildRuleLine).join("\n");
  }
  const nextLines = [...parsed.lines];
  parsed.indices.forEach((lineIndex, idx) => {
    const rule = ordered[idx];
    if (rule) {
      nextLines[lineIndex] = buildRuleLine(rule);
    }
  });
  return nextLines.join("\n");
}

export function RulesPanel({
  onStatus,
  onDirtyChange,
  onRegisterSave,
  onRegisterDiscard,
}: PanelProps) {
  const [items, setItems] = React.useState<FileEntry[]>([]);
  const [selectedName, setSelectedName] = React.useState<string | null>(null);
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const [content, setContent] = React.useState("");
  const [mode, setMode] = React.useState<"friendly" | "code">("friendly");
  const [dirty, setDirty] = React.useState(false);
  const [loadingList, setLoadingList] = React.useState(false);
  const [loadingItem, setLoadingItem] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [createName, setCreateName] = React.useState("");
  const [createError, setCreateError] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [renameName, setRenameName] = React.useState("");
  const [renameError, setRenameError] = React.useState<string | null>(null);
  const [renaming, setRenaming] = React.useState(false);
  const [renameTarget, setRenameTarget] = React.useState<FileEntry | null>(null);
  const [newRuleOpen, setNewRuleOpen] = React.useState(false);
  const [newRuleType, setNewRuleType] = React.useState(SUPPORTED_RULE_TYPES[0]);
  const [newRuleContent, setNewRuleContent] = React.useState("");
  const [newRuleFlags, setNewRuleFlags] = React.useState<string[]>([]);
  const [newRuleError, setNewRuleError] = React.useState<string | null>(null);
  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  const [dropIndex, setDropIndex] = React.useState<number | null>(null);
  const selectedNameRef = React.useRef<string | null>(null);
  const { confirm, ConfirmDialog } = useConfirmDialog();

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

  React.useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const handleSave = React.useCallback(async (): Promise<boolean> => {
    if (!selectedName) {
      return true;
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
      return true;
    } catch (err) {
      onStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Save failed",
      });
      return false;
    } finally {
      setSaving(false);
    }
  }, [content, onStatus, selectedName]);

  React.useEffect(() => {
    if (!onRegisterSave) {
      return;
    }
    onRegisterSave(handleSave);
  }, [handleSave, onRegisterSave]);

  React.useEffect(() => {
    if (!onRegisterDiscard) {
      return;
    }
    onRegisterDiscard(async () => {
      if (selectedName) {
        await loadItem(selectedName);
      } else {
        setDirty(false);
      }
    });
  }, [loadItem, onRegisterDiscard, selectedName]);

  const parsedRules = React.useMemo(() => parseRuleLines(content), [content]);
  const ruleItems = parsedRules.items;
  const canReorder = ruleItems.length > 1;

  const resetCreateForm = React.useCallback(() => {
    setCreateName("");
    setCreateError(null);
  }, []);

  const handleCreateOpenChange = React.useCallback(
    (open: boolean) => {
      setCreateOpen(open);
      if (!open) {
        resetCreateForm();
      }
    },
    [resetCreateForm]
  );

  const handleCreate = React.useCallback(async () => {
    const trimmed = createName.trim();
    if (!trimmed) {
      setCreateError("Enter a file name.");
      return;
    }
    if (trimmed.includes("/") || trimmed.includes("\\")) {
      setCreateError("Nested paths are not supported.");
      return;
    }
    let finalName = trimmed;
    const ext = trimmed.split(".").pop()?.toLowerCase() ?? "";
    if (!ext || ext === trimmed) {
      finalName = `${trimmed}.${DEFAULT_RULE_EXTENSION}`;
    } else if (!RULE_FILE_EXTS.includes(ext)) {
      setCreateError("Use .list, .yaml, or .yml.");
      return;
    }
    const targetUrl = `/api/rules/${encodeURIComponent(finalName)}`;
    try {
      const hasExisting = await isFileNonEmpty(targetUrl);
      if (hasExisting) {
        const ok = await confirm({
          title: "Overwrite existing rule file?",
          description:
            `The file "${finalName}" already exists and is not empty.\n\n` +
            "Continuing will overwrite it and cannot be undone.",
          confirmLabel: "Overwrite file",
          destructive: true,
        });
        if (!ok) {
          return;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Create failed";
      setCreateError(message);
      onStatus({ kind: "error", message });
      return;
    }
    setCreating(true);
    try {
      const payload = "";
      const response = await fetchJson<UpdateFileResponse>(
        targetUrl,
        {
          method: "PUT",
          body: JSON.stringify({ content: payload }),
        }
      );
      setSelectedName(finalName);
      selectedNameRef.current = finalName;
      setSelectedPath(response.path);
      setContent(payload);
      setDirty(false);
      setCreateOpen(false);
      resetCreateForm();
      onStatus({ kind: "ok", message: `${finalName} created` });
      await loadList();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Create failed";
      setCreateError(message);
      onStatus({ kind: "error", message });
    } finally {
      setCreating(false);
    }
  }, [confirm, createName, loadList, onStatus, resetCreateForm]);

  const openRenameDialog = React.useCallback((item: FileEntry) => {
    setRenameTarget(item);
    setRenameName(item.name);
    setRenameError(null);
    setRenameOpen(true);
  }, []);

  const closeRenameDialog = React.useCallback(() => {
    setRenameOpen(false);
    setRenameTarget(null);
    setRenameName("");
    setRenameError(null);
    setRenaming(false);
  }, []);

  const handleRenameOpenChange = React.useCallback(
    (open: boolean) => {
      if (open) {
        setRenameOpen(true);
        return;
      }
      closeRenameDialog();
    },
    [closeRenameDialog]
  );

  const submitRename = React.useCallback(async () => {
    if (!renameTarget) {
      return;
    }
    const trimmed = renameName.trim();
    if (!trimmed) {
      setRenameError("Enter a file name.");
      return;
    }
    if (trimmed.includes("/") || trimmed.includes("\\")) {
      setRenameError("Nested paths are not supported.");
      return;
    }
    const currentExt = renameTarget.name.split(".").pop()?.toLowerCase() ?? "";
    let finalName = trimmed;
    const ext = trimmed.split(".").pop()?.toLowerCase() ?? "";
    if (!ext || ext === trimmed) {
      finalName = currentExt
        ? `${trimmed}.${currentExt}`
        : `${trimmed}.${DEFAULT_RULE_EXTENSION}`;
    } else if (!RULE_FILE_EXTS.includes(ext)) {
      setRenameError("Use .list, .yaml, or .yml.");
      return;
    }
    if (finalName === renameTarget.name) {
      closeRenameDialog();
      return;
    }
    setRenaming(true);
    try {
      const response = await fetchJson<RenameFileResponse>(
        `/api/rules/${encodeURIComponent(renameTarget.name)}/rename`,
        {
          method: "POST",
          body: JSON.stringify({ name: finalName }),
        }
      );
      if (renameTarget.name === selectedName) {
        selectedNameRef.current = response.name;
        await loadItem(response.name);
        setSelectedPath(response.path);
      }
      onStatus({
        kind: "ok",
        message: `${renameTarget.name} renamed to ${response.name}`,
      });
      await loadList();
      closeRenameDialog();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Rename failed";
      setRenameError(message);
      onStatus({ kind: "error", message });
    } finally {
      setRenaming(false);
    }
  }, [
    closeRenameDialog,
    loadItem,
    loadList,
    onStatus,
    renameName,
    renameTarget,
    selectedName,
  ]);

  const handleDelete = React.useCallback(
    async (item: FileEntry) => {
      const warning =
        item.name === selectedName && dirty
          ? `The file "${item.name}" has unsaved changes.\n\n` +
            "Deleting will discard them and remove the file."
          : `Delete "${item.name}"? This cannot be undone.`;
      const ok = await confirm({
        title: `Delete ${item.name}?`,
        description: warning,
        confirmLabel: "Delete file",
        destructive: true,
      });
      if (!ok) {
        return;
      }
      try {
        await fetchJson<DeleteFileResponse>(
          `/api/rules/${encodeURIComponent(item.name)}`,
          { method: "DELETE" }
        );
        if (item.name === selectedName) {
          selectedNameRef.current = null;
          setSelectedName(null);
          setSelectedPath(null);
          setContent("");
          setDirty(false);
        }
        onStatus({ kind: "ok", message: `${item.name} deleted` });
        await loadList();
      } catch (err) {
        onStatus({
          kind: "error",
          message: err instanceof Error ? err.message : "Delete failed",
        });
      }
    },
    [confirm, dirty, loadList, onStatus, selectedName]
  );

  const resetNewRuleForm = React.useCallback(() => {
    setNewRuleType(SUPPORTED_RULE_TYPES[0]);
    setNewRuleContent("");
    setNewRuleFlags([]);
    setNewRuleError(null);
  }, []);

  const handleNewRuleOpenChange = React.useCallback(
    (open: boolean) => {
      setNewRuleOpen(open);
      if (!open) {
        resetNewRuleForm();
      }
    },
    [resetNewRuleForm]
  );

  const handleAddRule = React.useCallback(() => {
    if (!selectedName) {
      setNewRuleError("Select a rule file first.");
      return;
    }
    const type = newRuleType.trim().toUpperCase();
    if (!isSupportedRuleType(type)) {
      setNewRuleError("Unsupported rule type.");
      return;
    }
    const nextRule: RuleItem = {
      id: `new-${Date.now()}`,
      index: 0,
      type,
      content: newRuleContent.trim(),
      flags: newRuleFlags,
      raw: "",
    };
    const line = buildRuleLine(nextRule);
    setContent((prev) => {
      const trimmed = prev.replace(/\s*$/, "");
      return trimmed ? `${trimmed}\n${line}` : line;
    });
    setDirty(true);
    setNewRuleOpen(false);
    resetNewRuleForm();
  }, [newRuleContent, newRuleFlags, newRuleType, resetNewRuleForm, selectedName]);

  const handleToggleFlag = React.useCallback((flag: string, checked: boolean) => {
    setNewRuleFlags((prev) => {
      if (checked) {
        return prev.includes(flag) ? prev : [...prev, flag];
      }
      return prev.filter((value) => value !== flag);
    });
  }, []);

  const moveRule = React.useCallback(
    (fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex) {
        return;
      }
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= parsedRules.items.length ||
        toIndex >= parsedRules.items.length
      ) {
        return;
      }
      const nextItems = [...parsedRules.items];
      const [moved] = nextItems.splice(fromIndex, 1);
      nextItems.splice(toIndex, 0, moved);
      const nextContent = applyRuleOrder(parsedRules, nextItems);
      setContent(nextContent);
      setDirty(true);
    },
    [parsedRules]
  );

  const handleDragStart = React.useCallback(
    (index: number, id: string) => (event: React.DragEvent<HTMLDivElement>) => {
      event.dataTransfer.setData("text/plain", String(index));
      event.dataTransfer.effectAllowed = "move";
      setDraggingId(id);
    },
    []
  );

  const handleDragOver = React.useCallback(
    (index: number) => (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDropIndex(index);
    },
    []
  );

  const handleDrop = React.useCallback(
    (index: number) => (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const raw = event.dataTransfer.getData("text/plain");
      const fromIndex = Number(raw);
      if (!Number.isFinite(fromIndex)) {
        setDropIndex(null);
        setDraggingId(null);
        return;
      }
      moveRule(fromIndex, index);
      setDropIndex(null);
      setDraggingId(null);
    },
    [moveRule]
  );

  const handleDragEnd = React.useCallback(() => {
    setDropIndex(null);
    setDraggingId(null);
  }, []);

  const renameHasUnsaved = renameTarget?.name === selectedName && dirty;

  return (
    <>
      <Dialog open={renameOpen} onOpenChange={handleRenameOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename rule file</DialogTitle>
            <DialogDescription>
              Rename the file. Use .list, .yaml, or .yml.
            </DialogDescription>
          </DialogHeader>
          <form
            className="mt-4 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submitRename();
            }}
          >
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                File name
              </p>
              <Input
                autoFocus
                value={renameName}
                onChange={(event) => {
                  setRenameName(event.target.value);
                  setRenameError(null);
                }}
                placeholder="rules.yaml"
              />
            </div>
            {renameHasUnsaved && (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
                This file has unsaved changes. Renaming will discard them.
              </div>
            )}
            {renameError && (
              <p className="text-xs text-rose-500">{renameError}</p>
            )}
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={closeRenameDialog}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={renaming}>
                {renaming ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Pencil className="h-4 w-4" />
                )}
                Rename
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card className="animate-[fade-in_0.5s_ease_forwards]">
        <CardHeader>
          <CardTitle>Rules</CardTitle>
          <CardDescription>Rule files referenced by the rulesets.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="subtle"
              size="sm"
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
            <Dialog open={createOpen} onOpenChange={handleCreateOpenChange}>
              <DialogTrigger asChild>
                <Button variant="secondary" size="sm">
                  <Plus className="h-4 w-4" />
                  New file
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>New rule file</DialogTitle>
                  <DialogDescription>
                    Create a rules file (.list, .yaml, or .yml).
                  </DialogDescription>
                </DialogHeader>
                <div className="mt-4 space-y-3">
                  <Input
                    value={createName}
                    onChange={(event) => {
                      setCreateName(event.target.value);
                      setCreateError(null);
                    }}
                    placeholder={`rules.${DEFAULT_RULE_EXTENSION}`}
                  />
                  {createError && (
                    <p className="text-xs text-rose-500">{createError}</p>
                  )}
                  <Button onClick={() => void handleCreate()} disabled={creating}>
                    {creating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    Create file
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
          {items.length === 0 && !loadingList && (
            <div className="rounded-2xl border border-dashed border-border/60 bg-muted/40 px-4 py-6 text-sm text-muted-foreground">
              No rule files found.
            </div>
          )}
          <div className="space-y-2">
            {items.map((item) => {
              const isActive = item.name === selectedName;
              return (
                <div
                  key={item.name}
                  className={cn(
                    "flex w-full items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-left text-sm transition",
                    isActive
                      ? "border-primary/60 bg-primary/10 text-foreground"
                      : "border-border/50 bg-background/60 hover:border-primary/40"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => void loadItem(item.name)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{item.name}</span>
                      {dirty && isActive && (
                        <Badge variant="warning" className="shrink-0">
                          Unsaved
                        </Badge>
                      )}
                    </div>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">
                      {item.path}
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openRenameDialog(item)}
                      aria-label={`Rename ${item.name}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-rose-600 hover:text-rose-600"
                      onClick={() => void handleDelete(item)}
                      aria-label={`Delete ${item.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
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
            <div className="flex flex-wrap items-center gap-2">
              <Dialog open={newRuleOpen} onOpenChange={handleNewRuleOpenChange}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline" disabled={!selectedName}>
                    <Plus className="h-4 w-4" />
                    New rule
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add rule</DialogTitle>
                    <DialogDescription>
                      Choose a type, content, and optional flags.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="mt-4 space-y-4">
                    <div className="space-y-2">
                      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                        Type
                      </p>
                      <select
                        value={newRuleType}
                        onChange={(event) => {
                          setNewRuleType(event.target.value);
                          setNewRuleError(null);
                        }}
                        className="h-10 w-full rounded-2xl border border-border/60 bg-background/70 px-4 py-2 text-sm text-foreground shadow-sm backdrop-blur outline-none transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        {SUPPORTED_RULE_TYPES.map((ruleType) => (
                          <option key={ruleType} value={ruleType}>
                            {ruleType}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                        Content
                      </p>
                      <Input
                        value={newRuleContent}
                        onChange={(event) => {
                          setNewRuleContent(event.target.value);
                          setNewRuleError(null);
                        }}
                        placeholder="example.com or 1.2.3.0/24"
                      />
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                        Flags
                      </p>
                      <div className="space-y-2">
                        {SUPPORTED_RULE_FLAGS.map((flag) => {
                          const checked = newRuleFlags.includes(flag);
                          return (
                            <div
                              key={flag}
                              className="flex items-center justify-between rounded-2xl border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
                            >
                              <span className="font-medium text-foreground">
                                {flag}
                              </span>
                              <Switch
                                checked={checked}
                                onCheckedChange={(value) =>
                                  handleToggleFlag(flag, value)
                                }
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    {newRuleError && (
                      <p className="text-xs text-rose-500">{newRuleError}</p>
                    )}
                    <Button onClick={handleAddRule} disabled={!selectedName}>
                      <Plus className="h-4 w-4" />
                      Add rule
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
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
              <Button
                onClick={() => void handleSave()}
                disabled={!selectedName || saving || loadingItem}
                size="sm"
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
                size="sm"
              >
                <RefreshCw className="h-4 w-4" />
                Reload
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
              {ruleItems.map((rule, index) => {
                const isDragging = draggingId === rule.id;
                const isDropTarget = dropIndex === index;
                return (
                  <div
                    key={rule.id}
                    draggable={canReorder}
                    onDragOver={canReorder ? handleDragOver(index) : undefined}
                    onDragStart={
                      canReorder ? handleDragStart(index, rule.id) : undefined
                    }
                    onDragEnd={handleDragEnd}
                    onDrop={canReorder ? handleDrop(index) : undefined}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-2xl border px-3 py-2 text-xs",
                      canReorder && "cursor-grab",
                      isDropTarget
                        ? "border-primary/60 bg-primary/10"
                        : "border-border/50 bg-muted/40",
                      isDragging && "opacity-60"
                    )}
                  >
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3 text-muted-foreground">
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
                    <div
                      aria-hidden="true"
                      className={cn(
                        "flex h-8 w-8 items-center justify-center rounded-full border border-border/60 text-muted-foreground transition",
                        !canReorder && "cursor-not-allowed opacity-40"
                      )}
                    >
                      <GripVertical className="h-4 w-4" />
                    </div>
                  </div>
                );
              })}
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
      </Card>
    </div>
    {ConfirmDialog}
    </>
  );
}
