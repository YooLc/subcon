"use client";

import * as React from "react";
import { BadgeCheck, Code2, Loader2, RefreshCw, Save } from "lucide-react";

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
import { fetchJson } from "@/components/studio/api";
import { languageForFile } from "@/components/studio/utils";
import type {
  FileContentResponse,
  GroupEntry,
  GroupResponse,
  PanelProps,
  UpdateFileResponse,
} from "@/components/studio/types";

type TomlBlock = {
  start: number;
  end: number;
  text: string;
  key: string | null;
};

function extractTomlStringValue(block: string, key: string): string | null {
  const re = new RegExp(
    `^\\s*${key}\\s*=\\s*(\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*')`,
    "m"
  );
  const match = block.match(re);
  if (!match) {
    return null;
  }
  const raw = match[1];
  const quote = raw[0];
  let value = raw.slice(1, -1);
  if (quote === '"') {
    value = value.replace(/\\\\/g, "\\").replace(/\\"/g, "\"");
    value = value.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
  } else {
    value = value.replace(/\\\\/g, "\\").replace(/\\'/g, "'");
  }
  return value;
}

function splitTomlBlocks(content: string, header: string, key: string): TomlBlock[] {
  const pattern = new RegExp(
    `^\\s*\\[\\[${header}\\]\\]\\s*(?:#.*)?$`,
    "gm"
  );
  const matches = [...content.matchAll(pattern)];
  if (matches.length === 0) {
    return [];
  }
  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const end =
      index + 1 < matches.length
        ? (matches[index + 1].index ?? content.length)
        : content.length;
    const text = content.slice(start, end);
    return {
      start,
      end,
      text,
      key: extractTomlStringValue(text, key),
    };
  });
}

function findTomlBlock(
  content: string,
  header: string,
  key: string,
  target: string
): TomlBlock | null {
  const blocks = splitTomlBlocks(content, header, key);
  return blocks.find((block) => block.key === target) ?? null;
}

function replaceTomlBlock(
  content: string,
  header: string,
  key: string,
  target: string,
  nextText: string
): string | null {
  const blocks = splitTomlBlocks(content, header, key);
  const match = blocks.find((block) => block.key === target);
  if (!match) {
    return null;
  }
  const trailing = match.text.match(/\s*$/)?.[0] ?? "";
  const normalized = nextText.replace(/\s*$/, "");
  const replacement = normalized + trailing;
  return content.slice(0, match.start) + replacement + content.slice(match.end);
}

export function GroupsPanel({
  onStatus,
  onDirtyChange,
  onRegisterSave,
  onRegisterDiscard,
}: PanelProps) {
  const [groups, setGroups] = React.useState<GroupEntry[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [groupsEditorOpen, setGroupsEditorOpen] = React.useState(false);
  const [groupsSnippet, setGroupsSnippet] = React.useState<FileContentResponse | null>(
    null
  );
  const [groupsContent, setGroupsContent] = React.useState("");
  const [groupsSnippetLoading, setGroupsSnippetLoading] = React.useState(false);
  const [groupsSnippetError, setGroupsSnippetError] = React.useState<string | null>(null);
  const [groupsSnippetSaving, setGroupsSnippetSaving] = React.useState(false);
  const [rulesetsEditorOpen, setRulesetsEditorOpen] = React.useState(false);
  const [rulesetsSnippet, setRulesetsSnippet] = React.useState<FileContentResponse | null>(
    null
  );
  const [rulesetsContent, setRulesetsContent] = React.useState("");
  const [rulesetsSnippetLoading, setRulesetsSnippetLoading] = React.useState(false);
  const [rulesetsSnippetError, setRulesetsSnippetError] = React.useState<string | null>(
    null
  );
  const [rulesetsSnippetSaving, setRulesetsSnippetSaving] = React.useState(false);
  const [sectionEditorOpen, setSectionEditorOpen] = React.useState(false);
  const [sectionEditorKind, setSectionEditorKind] = React.useState<
    "groups" | "rulesets"
  >("groups");
  const [sectionEditorTarget, setSectionEditorTarget] = React.useState("");
  const [sectionEditorContent, setSectionEditorContent] = React.useState("");
  const [sectionEditorLoading, setSectionEditorLoading] = React.useState(false);
  const [sectionEditorError, setSectionEditorError] = React.useState<string | null>(
    null
  );
  const groupsDirty =
    !!groupsSnippet && groupsContent !== groupsSnippet.content;
  const rulesetsDirty =
    !!rulesetsSnippet && rulesetsContent !== rulesetsSnippet.content;
  const hasDirty = groupsDirty || rulesetsDirty;

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

  React.useEffect(() => {
    onDirtyChange?.(hasDirty);
  }, [hasDirty, onDirtyChange]);

  const loadGroupsSnippet = React.useCallback(async (): Promise<FileContentResponse | null> => {
    setGroupsSnippetLoading(true);
    setGroupsSnippetError(null);
    try {
      const data = await fetchJson<FileContentResponse>("/api/snippets/groups");
      setGroupsSnippet(data);
      setGroupsContent(data.content);
      return data;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load groups.toml";
      setGroupsSnippetError(message);
      onStatus({ kind: "error", message });
      return null;
    } finally {
      setGroupsSnippetLoading(false);
    }
  }, [onStatus]);

  const loadRulesetsSnippet = React.useCallback(
    async (): Promise<FileContentResponse | null> => {
    setRulesetsSnippetLoading(true);
    setRulesetsSnippetError(null);
    try {
      const data = await fetchJson<FileContentResponse>("/api/snippets/rulesets");
      setRulesetsSnippet(data);
      setRulesetsContent(data.content);
      return data;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load rulesets.toml";
      setRulesetsSnippetError(message);
      onStatus({ kind: "error", message });
      return null;
    } finally {
      setRulesetsSnippetLoading(false);
    }
  }, [onStatus]);

  const saveGroupsContent = React.useCallback(
    async (nextContent: string, message: string): Promise<boolean> => {
    setGroupsSnippetSaving(true);
    try {
      await fetchJson<UpdateFileResponse>("/api/snippets/groups", {
        method: "PUT",
        body: JSON.stringify({ content: nextContent }),
      });
      setGroupsContent(nextContent);
      setGroupsSnippet((prev) =>
        prev ? { ...prev, content: nextContent } : prev
      );
      onStatus({ kind: "ok", message });
      await loadGroups();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Save failed";
      onStatus({ kind: "error", message });
      return false;
    } finally {
      setGroupsSnippetSaving(false);
    }
  }, [loadGroups, onStatus]);

  const saveRulesetsContent = React.useCallback(
    async (nextContent: string, message: string): Promise<boolean> => {
    setRulesetsSnippetSaving(true);
    try {
      await fetchJson<UpdateFileResponse>("/api/snippets/rulesets", {
        method: "PUT",
        body: JSON.stringify({ content: nextContent }),
      });
      setRulesetsContent(nextContent);
      setRulesetsSnippet((prev) =>
        prev ? { ...prev, content: nextContent } : prev
      );
      onStatus({ kind: "ok", message });
      await loadGroups();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Save failed";
      onStatus({ kind: "error", message });
      return false;
    } finally {
      setRulesetsSnippetSaving(false);
    }
  }, [loadGroups, onStatus]);

  const saveGroupsSnippet = React.useCallback(
    async (): Promise<boolean> => saveGroupsContent(groupsContent, "groups.toml saved"),
    [groupsContent, saveGroupsContent]
  );

  const saveRulesetsSnippet = React.useCallback(
    async (): Promise<boolean> =>
      saveRulesetsContent(rulesetsContent, "rulesets.toml saved"),
    [rulesetsContent, saveRulesetsContent]
  );

  const openSectionEditor = React.useCallback(
    async (kind: "groups" | "rulesets", target: string) => {
      setSectionEditorKind(kind);
      setSectionEditorTarget(target);
      setSectionEditorContent("");
      setSectionEditorError(null);
      setSectionEditorLoading(true);
      setSectionEditorOpen(true);

      let fileContent = kind === "groups" ? groupsContent : rulesetsContent;
      if (!fileContent) {
        const data =
          kind === "groups" ? await loadGroupsSnippet() : await loadRulesetsSnippet();
        fileContent = data?.content ?? "";
      }

      if (!fileContent) {
        setSectionEditorError("Snippet not loaded.");
        setSectionEditorLoading(false);
        return;
      }

      const header = kind === "groups" ? "groups" : "rulesets";
      const key = kind === "groups" ? "name" : "group";
      const block = findTomlBlock(fileContent, header, key, target);
      if (!block) {
        setSectionEditorError(`Section not found for "${target}".`);
        setSectionEditorLoading(false);
        return;
      }

      setSectionEditorContent(block.text.trim());
      setSectionEditorLoading(false);
    },
    [groupsContent, loadGroupsSnippet, loadRulesetsSnippet, rulesetsContent]
  );

  const saveSectionEditor = React.useCallback(async (): Promise<boolean> => {
    const header = sectionEditorKind === "groups" ? "groups" : "rulesets";
    const key = sectionEditorKind === "groups" ? "name" : "group";
    const content = sectionEditorContent.trim();
    if (!content) {
      setSectionEditorError("Section is empty.");
      return false;
    }
    if (!new RegExp(`^\\s*\\[\\[${header}\\]\\]\\s*(?:#.*)?$`, "m").test(content)) {
      setSectionEditorError(`Section must include [[${header}]].`);
      return false;
    }
    const updatedKey = extractTomlStringValue(content, key);
    if (!updatedKey) {
      setSectionEditorError(`Missing "${key}" in section.`);
      return false;
    }

    const fileContent = sectionEditorKind === "groups" ? groupsContent : rulesetsContent;
    if (!fileContent) {
      setSectionEditorError("Snippet not loaded.");
      return false;
    }

    const updated = replaceTomlBlock(
      fileContent,
      header,
      key,
      sectionEditorTarget,
      content
    );
    if (!updated) {
      setSectionEditorError("Section not found in file.");
      return false;
    }

    const label =
      sectionEditorKind === "groups"
        ? `${updatedKey} group saved`
        : `${updatedKey} rulesets saved`;
    const ok =
      sectionEditorKind === "groups"
        ? await saveGroupsContent(updated, label)
        : await saveRulesetsContent(updated, label);
    if (ok) {
      setSectionEditorOpen(false);
    }
    return ok;
  }, [
    groupsContent,
    rulesetsContent,
    saveGroupsContent,
    saveRulesetsContent,
    sectionEditorContent,
    sectionEditorKind,
    sectionEditorTarget,
  ]);

  const sectionEditorTitle =
    sectionEditorKind === "groups"
      ? `Edit group: ${sectionEditorTarget}`
      : `Edit rulesets: ${sectionEditorTarget}`;
  const sectionEditorDescription =
    sectionEditorKind === "groups"
      ? "Update a single [[groups]] block."
      : "Update a single [[rulesets]] block.";
  const sectionEditorPath =
    sectionEditorKind === "groups" ? groupsSnippet?.path : rulesetsSnippet?.path;
  const sectionEditorLanguage = languageForFile(
    sectionEditorKind === "groups" ? "groups.toml" : "rulesets.toml"
  );
  const sectionEditorSaving =
    sectionEditorKind === "groups" ? groupsSnippetSaving : rulesetsSnippetSaving;

  React.useEffect(() => {
    if (!onRegisterSave) {
      return;
    }
    onRegisterSave(async () => {
      let ok = true;
      if (groupsDirty) {
        ok = (await saveGroupsSnippet()) && ok;
      }
      if (rulesetsDirty) {
        ok = (await saveRulesetsSnippet()) && ok;
      }
      return ok;
    });
  }, [
    groupsDirty,
    onRegisterSave,
    rulesetsDirty,
    saveGroupsSnippet,
    saveRulesetsSnippet,
  ]);

  React.useEffect(() => {
    if (!onRegisterDiscard) {
      return;
    }
    onRegisterDiscard(async () => {
      if (groupsSnippet) {
        setGroupsContent(groupsSnippet.content);
      }
      if (rulesetsSnippet) {
        setRulesetsContent(rulesetsSnippet.content);
      }
    });
  }, [groupsSnippet, onRegisterDiscard, rulesetsSnippet]);

  return (
    <Card className="animate-[fade-in_0.5s_ease_forwards]">
      <CardHeader>
        <CardTitle>Groups</CardTitle>
        <CardDescription>Proxy groups and their rulesets.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Dialog
          open={sectionEditorOpen}
          onOpenChange={(open) => {
            setSectionEditorOpen(open);
            if (!open) {
              setSectionEditorError(null);
              setSectionEditorContent("");
              setSectionEditorTarget("");
              setSectionEditorLoading(false);
            }
          }}
        >
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>{sectionEditorTitle}</DialogTitle>
              <DialogDescription>{sectionEditorDescription}</DialogDescription>
            </DialogHeader>
            <div className="mt-4 space-y-3">
              {sectionEditorError && (
                <p className="text-xs text-rose-500">{sectionEditorError}</p>
              )}
              {sectionEditorLoading ? (
                <div className="rounded-2xl border border-dashed border-border/60 bg-muted/40 px-4 py-6 text-xs text-muted-foreground">
                  Loading section...
                </div>
              ) : (
                <CodeEditor
                  value={sectionEditorContent}
                  language={sectionEditorLanguage}
                  height="320px"
                  onChange={setSectionEditorContent}
                  className="rounded-2xl border border-border/60 bg-muted/30"
                />
              )}
              <Button
                onClick={() => void saveSectionEditor()}
                disabled={
                  sectionEditorLoading ||
                  sectionEditorSaving ||
                  !sectionEditorContent.trim() ||
                  !!sectionEditorError
                }
              >
                {sectionEditorSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save section
              </Button>
              {sectionEditorPath && (
                <p className="text-xs text-muted-foreground">{sectionEditorPath}</p>
              )}
            </div>
          </DialogContent>
        </Dialog>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{groups.length} groups loaded</p>
          <div className="flex flex-wrap items-center gap-2">
            <Dialog
              open={groupsEditorOpen}
              onOpenChange={(open) => {
                setGroupsEditorOpen(open);
                if (open) {
                  void loadGroupsSnippet();
                }
              }}
            >
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Code2 className="h-4 w-4" />
                  Edit groups.toml
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-3xl">
                <DialogHeader>
                  <DialogTitle>Edit groups.toml</DialogTitle>
                  <DialogDescription>
                    Update group definitions for proxy matching.
                  </DialogDescription>
                </DialogHeader>
                <div className="mt-4 space-y-3">
                  {groupsSnippetError && (
                    <p className="text-xs text-rose-500">{groupsSnippetError}</p>
                  )}
                  {groupsSnippetLoading ? (
                    <div className="rounded-2xl border border-dashed border-border/60 bg-muted/40 px-4 py-6 text-xs text-muted-foreground">
                      Loading groups.toml...
                    </div>
                  ) : (
                    <CodeEditor
                      value={groupsContent}
                      language="plaintext"
                      height="360px"
                      onChange={setGroupsContent}
                      className="rounded-2xl border border-border/60 bg-muted/30"
                    />
                  )}
                  <Button
                    onClick={() => void saveGroupsSnippet()}
                    disabled={groupsSnippetLoading || groupsSnippetSaving}
                  >
                    {groupsSnippetSaving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Save groups.toml
                  </Button>
                  {groupsSnippet?.path && (
                    <p className="text-xs text-muted-foreground">
                      {groupsSnippet.path}
                    </p>
                  )}
                </div>
              </DialogContent>
            </Dialog>
            <Dialog
              open={rulesetsEditorOpen}
              onOpenChange={(open) => {
                setRulesetsEditorOpen(open);
                if (open) {
                  void loadRulesetsSnippet();
                }
              }}
            >
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Code2 className="h-4 w-4" />
                  Edit rulesets.toml
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-3xl">
                <DialogHeader>
                  <DialogTitle>Edit rulesets.toml</DialogTitle>
                  <DialogDescription>
                    Update ruleset mappings for each group.
                  </DialogDescription>
                </DialogHeader>
                <div className="mt-4 space-y-3">
                  {rulesetsSnippetError && (
                    <p className="text-xs text-rose-500">{rulesetsSnippetError}</p>
                  )}
                  {rulesetsSnippetLoading ? (
                    <div className="rounded-2xl border border-dashed border-border/60 bg-muted/40 px-4 py-6 text-xs text-muted-foreground">
                      Loading rulesets.toml...
                    </div>
                  ) : (
                    <CodeEditor
                      value={rulesetsContent}
                      language="plaintext"
                      height="360px"
                      onChange={setRulesetsContent}
                      className="rounded-2xl border border-border/60 bg-muted/30"
                    />
                  )}
                  <Button
                    onClick={() => void saveRulesetsSnippet()}
                    disabled={rulesetsSnippetLoading || rulesetsSnippetSaving}
                  >
                    {rulesetsSnippetSaving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Save rulesets.toml
                  </Button>
                  {rulesetsSnippet?.path && (
                    <p className="text-xs text-muted-foreground">
                      {rulesetsSnippet.path}
                    </p>
                  )}
                </div>
              </DialogContent>
            </Dialog>
            <Button variant="subtle" onClick={() => void loadGroups()} disabled={loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Refresh
            </Button>
          </div>
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
              className="flex h-[360px] flex-col rounded-3xl border border-border/50 bg-card/60 p-5 shadow-sm backdrop-blur"
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
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void openSectionEditor("groups", group.name)}
                  disabled={groupsSnippetLoading || groupsSnippetSaving}
                >
                  <Code2 className="h-4 w-4" />
                  Edit group
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void openSectionEditor("rulesets", group.name)}
                  disabled={rulesetsSnippetLoading || rulesetsSnippetSaving}
                >
                  <Code2 className="h-4 w-4" />
                  Edit rulesets
                </Button>
              </div>
              <div className="mt-4 flex-1 min-h-0 text-xs text-muted-foreground">
                <div className="grid h-full min-h-0 gap-4 md:grid-cols-2">
                  <div className="flex min-h-0 flex-col rounded-3xl border border-border/40 bg-background/60 p-3 shadow-sm">
                    <div className="sticky top-0 z-10 -mx-1 flex items-center justify-between px-1 py-1 text-xs font-semibold text-muted-foreground">
                      <span>Matched proxies</span>
                      <Badge variant="outline">{group.proxies?.length ?? 0}</Badge>
                    </div>
                    <div className="mt-2 flex-1 min-h-0 overflow-y-auto pr-1">
                      {group.proxies && group.proxies.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {group.proxies.map((proxy, idx) => (
                            <Badge
                              key={`${group.name}-proxy-${idx}`}
                              variant="outline"
                              className="max-w-full break-all"
                            >
                              {proxy}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <p>No proxies matched.</p>
                      )}
                    </div>
                  </div>
                  <div className="flex min-h-0 flex-col rounded-3xl border border-border/40 bg-background/60 p-3 shadow-sm">
                    <div className="sticky top-0 z-10 -mx-1 flex items-center justify-between px-1 py-1 text-xs font-semibold text-muted-foreground">
                      <span>Rulesets</span>
                      <Badge variant="outline">{group.rulesets.length}</Badge>
                    </div>
                    <div className="mt-2 flex-1 min-h-0 overflow-y-auto pr-1">
                      {group.rulesets.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {group.rulesets.map((ruleset, idx) => (
                            <Badge
                              key={`${group.name}-ruleset-${idx}`}
                              variant="outline"
                              className="max-w-full break-all"
                            >
                              {ruleset}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <p>No rulesets mapped.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
