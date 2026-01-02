"use client";

import * as React from "react";
import YAML from "yaml";
import {
  Code2,
  Layers3,
  LayoutGrid,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Star,
  ToggleLeft,
  ToggleRight,
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { fetchJson } from "@/components/studio/api";
import { useConfirmDialog } from "@/components/studio/confirm-dialog";
import { isFileNonEmpty, languageForFile } from "@/components/studio/utils";
import type {
  FileContentResponse,
  FileEntry,
  FileListResponse,
  PanelProps,
  SchemaCell,
  SchemaState,
  UpdateFileResponse,
} from "@/components/studio/types";

function parseSchema(content: string): SchemaState {
  const raw = (YAML.parse(content) ?? {}) as Record<string, unknown>;
  const protocol = typeof raw.protocol === "string" ? raw.protocol : "unknown";
  const fieldsObject = (raw.fields ?? {}) as Record<string, unknown>;
  const fields = Object.keys(fieldsObject);
  const targetsObject = (raw.targets ?? {}) as Record<string, unknown>;

  const targets = Object.entries(targetsObject).map(([name, targetValue]) => {
    const targetRaw = (targetValue ?? {}) as Record<string, unknown>;
    const template = (targetRaw.template ?? {}) as Record<string, unknown>;
    const mappings: Record<string, SchemaCell> = {};
    const extraTemplate: Record<string, unknown> = {};

    Object.entries(template).forEach(([outputKey, value]) => {
      const fieldRef = value as Record<string, unknown>;
      if (fieldRef && typeof fieldRef.from === "string") {
        const from = fieldRef.from;
        if (!mappings[from]) {
          mappings[from] = {
            to: outputKey,
            optional: Boolean(fieldRef.optional),
            defaultValue:
              fieldRef.default !== undefined ? formatFieldValue(fieldRef.default) : "",
          };
          return;
        }
      }
      extraTemplate[outputKey] = value as unknown;
    });

    return {
      name,
      mappings,
      extraTemplate,
      raw: targetRaw,
    };
  });

  return { protocol, fields, targets, raw };
}

function buildSchemaYaml(state: SchemaState): string {
  const targets: Record<string, unknown> = {};
  state.targets.forEach((target) => {
    const template: Record<string, unknown> = { ...target.extraTemplate };

    state.fields.forEach((field) => {
      const cell = target.mappings[field];
      if (!cell || cell.to.trim() === "") {
        return;
      }
      const entry: Record<string, unknown> = {
        from: field,
      };
      if (cell.optional) {
        entry.optional = true;
        if (cell.defaultValue.trim() !== "") {
          entry.default = parseDefaultValue(cell.defaultValue);
        }
      }
      template[cell.to] = entry;
    });

    const { template: _ignored, ...rest } = target.raw;
    targets[target.name] = {
      ...rest,
      template,
    };
  });

  const output: Record<string, unknown> = {
    ...state.raw,
    protocol: state.protocol,
    targets,
  };

  return YAML.stringify(output, { indent: 2 });
}

function parseDefaultValue(raw: string): unknown {
  try {
    return YAML.parse(raw);
  } catch {
    return raw;
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

const SCHEMA_FILE_EXTS = ["yaml", "yml"];
const DEFAULT_SCHEMA_EXTENSION = "yaml";
const DEFAULT_SCHEMA_CONTENT = 'protocol: ""\nfields: {}\ntargets: {}\n';

export function SchemaPanel({
  onStatus,
  onDirtyChange,
  onRegisterSave,
  onRegisterDiscard,
}: PanelProps) {
  const [items, setItems] = React.useState<FileEntry[]>([]);
  const [selectedName, setSelectedName] = React.useState<string | null>(null);
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const [content, setContent] = React.useState("");
  const [schemaState, setSchemaState] = React.useState<SchemaState | null>(null);
  const [mode, setMode] = React.useState<"friendly" | "code">("friendly");
  const [dirty, setDirty] = React.useState(false);
  const [loadingList, setLoadingList] = React.useState(false);
  const [loadingItem, setLoadingItem] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [parseError, setParseError] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [createName, setCreateName] = React.useState("");
  const [createError, setCreateError] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
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
          `/api/schema/${encodeURI(name)}`
        );
        setSelectedPath(data.path);
        setContent(data.content);
        setParseError(null);
        try {
          const parsed = parseSchema(data.content);
          setSchemaState(parsed);
        } catch (err) {
          setSchemaState(null);
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
      const data = await fetchJson<FileListResponse>("/api/schema");
      const filtered = data.items.filter((item) => !item.name.includes("include/"));
      setItems(filtered);
      const currentSelection = selectedNameRef.current;
      if (!currentSelection && filtered[0]) {
        await loadItem(filtered[0].name);
      } else if (
        currentSelection &&
        !filtered.find((item) => item.name === currentSelection)
      ) {
        if (filtered[0]) {
          await loadItem(filtered[0].name);
        } else {
          setSelectedName(null);
          setSelectedPath(null);
          setContent("");
          setSchemaState(null);
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
      const payload =
        mode === "code"
          ? content
          : schemaState
            ? buildSchemaYaml(schemaState)
            : content;
      await fetchJson<UpdateFileResponse>(
        `/api/schema/${encodeURI(selectedName)}`,
        {
          method: "PUT",
          body: JSON.stringify({ content: payload }),
        }
      );
      setContent(payload);
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
  }, [content, mode, onStatus, schemaState, selectedName]);

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
    let finalName = trimmed;
    const ext = trimmed.split(".").pop()?.toLowerCase() ?? "";
    if (!ext || ext === trimmed) {
      finalName = `${trimmed}.${DEFAULT_SCHEMA_EXTENSION}`;
    } else if (!SCHEMA_FILE_EXTS.includes(ext)) {
      setCreateError("Use .yaml or .yml.");
      return;
    }
    const targetUrl = `/api/schema/${encodeURI(finalName)}`;
    try {
      const hasExisting = await isFileNonEmpty(targetUrl);
      if (hasExisting) {
        const ok = await confirm({
          title: "Overwrite existing schema?",
          description:
            `The file "${finalName}" already exists and is not empty.\n\n` +
            "Continuing will overwrite it and cannot be undone.",
          confirmLabel: "Overwrite schema",
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
      const payload = DEFAULT_SCHEMA_CONTENT;
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
      setSchemaState(parseSchema(payload));
      setParseError(null);
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

  const updateCell = React.useCallback(
    (targetName: string, fieldName: string, updater: (cell: SchemaCell) => SchemaCell) => {
      setSchemaState((prev) => {
        if (!prev) {
          return prev;
        }
        return {
          ...prev,
          targets: prev.targets.map((target) => {
            if (target.name !== targetName) {
              return target;
            }
            const existing = target.mappings[fieldName] ?? {
              to: "",
              optional: false,
              defaultValue: "",
            };
            return {
              ...target,
              mappings: {
                ...target.mappings,
                [fieldName]: updater(existing),
              },
            };
          }),
        };
      });
      setDirty(true);
    },
    []
  );

  const switchMode = React.useCallback(
    (next: "friendly" | "code") => {
      if (next === mode) {
        return;
      }
      if (next === "code" && schemaState) {
        const yaml = buildSchemaYaml(schemaState);
        setContent(yaml);
      }
      if (next === "friendly") {
        try {
          const parsed = parseSchema(content);
          setSchemaState(parsed);
          setParseError(null);
        } catch (err) {
          setParseError(
            err instanceof Error ? err.message : "Failed to parse YAML"
          );
        }
      }
      setMode(next);
    },
    [content, mode, schemaState]
  );

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <Card className="animate-[fade-in_0.5s_ease_forwards]">
        <CardHeader>
          <CardTitle>Protocols</CardTitle>
          <CardDescription>Schema protocols and targets.</CardDescription>
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
                  <DialogTitle>New schema</DialogTitle>
                  <DialogDescription>
                    Create a schema file (.yaml or .yml). Nested paths are allowed.
                  </DialogDescription>
                </DialogHeader>
                <div className="mt-4 space-y-3">
                  <Input
                    value={createName}
                    onChange={(event) => {
                      setCreateName(event.target.value);
                      setCreateError(null);
                    }}
                    placeholder={`protocol.${DEFAULT_SCHEMA_EXTENSION}`}
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
              No schema files found.
            </div>
          )}
          <div className="space-y-2">
            {items.map((item) => {
              const isActive = item.name === selectedName;
              const protocolName = item.name.replace(/\.ya?ml$/i, "");
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
                    <span className="font-medium">{protocolName}</span>
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
      </Card>

      <Card className="animate-[fade-in_0.6s_ease_forwards]">
        <CardHeader className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Layers3 className="h-4 w-4 text-primary" />
                {schemaState?.protocol ?? "Schema"}
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
          {parseError && (
            <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-600">
              {parseError}
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {mode === "friendly" ? (
            <SchemaTable schema={schemaState} onCellChange={updateCell} />
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

type SchemaTableProps = {
  schema: SchemaState | null;
  onCellChange: (target: string, field: string, updater: (cell: SchemaCell) => SchemaCell) => void;
};

function SchemaTable({ schema, onCellChange }: SchemaTableProps) {
  if (!schema) {
    return (
      <div className="rounded-2xl border border-dashed border-border/60 bg-muted/40 px-4 py-6 text-sm text-muted-foreground">
        No schema loaded.
      </div>
    );
  }

  if (schema.fields.length === 0 || schema.targets.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border/60 bg-muted/40 px-4 py-6 text-sm text-muted-foreground">
        Schema fields or targets missing.
      </div>
    );
  }

  return (
    <div className="overflow-auto rounded-2xl border border-border/60">
      <table className="min-w-full border-separate border-spacing-0 text-xs">
        <thead>
          <tr className="bg-muted/50">
            <th className="sticky left-0 z-10 min-w-[160px] border-b border-border/60 bg-muted/50 px-4 py-3 text-left font-semibold text-muted-foreground">
              Field
            </th>
            {schema.targets.map((target) => (
              <th
                key={target.name}
                className="min-w-[220px] border-b border-border/60 px-4 py-3 text-left font-semibold text-muted-foreground"
              >
                {target.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {schema.fields.map((field) => (
            <tr key={field}>
              <td className="sticky left-0 z-10 border-b border-border/50 bg-background/70 px-4 py-3 text-left font-semibold text-foreground backdrop-blur">
                {field}
              </td>
              {schema.targets.map((target) => {
                const cell = target.mappings[field] ?? {
                  to: "",
                  optional: false,
                  defaultValue: "",
                };
                return (
                  <td
                    key={`${target.name}-${field}`}
                    className="border-b border-border/50 px-3 py-3 align-top"
                  >
                    <div className="flex items-start gap-2">
                      <textarea
                        value={cell.to}
                        onChange={(event) =>
                          onCellChange(target.name, field, (prev) => ({
                            ...prev,
                            to: event.target.value,
                          }))
                        }
                        rows={1}
                        placeholder="-"
                        className="w-full resize-none bg-transparent text-xs leading-relaxed text-foreground outline-none transition border-b border-transparent hover:border-muted-foreground/40 focus:border-primary/60"
                      />
                      <div className="flex items-center gap-2 pt-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() =>
                                onCellChange(target.name, field, (prev) => ({
                                  ...prev,
                                  optional: !prev.optional,
                                }))
                              }
                              className={cn(
                                "p-1 transition",
                                cell.optional ? "text-primary" : "text-muted-foreground"
                              )}
                            >
                              {cell.optional ? (
                                <ToggleRight className="h-4 w-4" />
                              ) : (
                                <ToggleLeft className="h-4 w-4" />
                              )}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {cell.optional ? "optional" : "required"}
                          </TooltipContent>
                        </Tooltip>

                        <Popover>
                          <Tooltip>
                            <PopoverTrigger asChild>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  disabled={!cell.optional}
                                  className={cn(
                                    "p-1 transition",
                                    cell.optional
                                      ? "text-primary"
                                      : "text-muted-foreground/50"
                                  )}
                                >
                                  <Star className="h-4 w-4" />
                                </button>
                              </TooltipTrigger>
                            </PopoverTrigger>
                            <TooltipContent>
                              {cell.defaultValue.trim() !== ""
                                ? cell.defaultValue
                                : "No default"}
                            </TooltipContent>
                          </Tooltip>
                          <PopoverContent>
                            <div className="space-y-2">
                              <p className="text-xs font-semibold text-muted-foreground">
                                Default value (YAML)
                              </p>
                              <Input
                                value={cell.defaultValue}
                                onChange={(event) =>
                                  onCellChange(target.name, field, (prev) => ({
                                    ...prev,
                                    defaultValue: event.target.value,
                                  }))
                                }
                                className="h-9"
                                placeholder='""'
                              />
                            </div>
                          </PopoverContent>
                        </Popover>
                      </div>
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
