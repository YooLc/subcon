"use client";
import * as React from "react";
import { Loader2, RefreshCw, Save } from "lucide-react";

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchJson } from "@/components/studio/api";
import type {
  ConfigResponse,
  FileContentResponse,
  PanelProps,
  UpdateFileResponse,
} from "@/components/studio/types";
import { languageForFile } from "@/components/studio/utils";

const RULE_BASE_TARGETS = [
  {
    key: "clash",
    label: "Clash base",
    description: "Base config for Clash subscriptions.",
  },
  {
    key: "surge",
    label: "Surge base",
    description: "Base config for Surge subscriptions.",
  },
] as const;

type RuleBaseKey = (typeof RULE_BASE_TARGETS)[number]["key"];

type RuleBaseState = {
  content: string;
  baseline: string;
  path: string | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
};

type ConfigPanelProps = PanelProps & {
  config: ConfigResponse | null;
  loading: boolean;
  onReload: () => Promise<void>;
};

export function ConfigPanel({
  config,
  loading,
  onReload,
  onStatus,
  onDirtyChange,
  onRegisterSave,
  onRegisterDiscard,
}: ConfigPanelProps) {
  const [prefDraft, setPrefDraft] = React.useState("");
  const [baselinePref, setBaselinePref] = React.useState("");
  const [prefSaving, setPrefSaving] = React.useState(false);
  const [ruleBases, setRuleBases] = React.useState<Record<RuleBaseKey, RuleBaseState>>(
    () => {
      const initial = {} as Record<RuleBaseKey, RuleBaseState>;
      for (const target of RULE_BASE_TARGETS) {
        initial[target.key] = {
          content: "",
          baseline: "",
          path: null,
          loading: false,
          saving: false,
          error: null,
        };
      }
      return initial;
    }
  );
  const [activeRuleBase, setActiveRuleBase] = React.useState<RuleBaseKey>(
    RULE_BASE_TARGETS[0]?.key ?? "clash"
  );

  const updateRuleBaseState = React.useCallback(
    (key: RuleBaseKey, patch: Partial<RuleBaseState>) => {
      setRuleBases((prev) => {
        const current = prev[key];
        if (!current) {
          return prev;
        }
        return { ...prev, [key]: { ...current, ...patch } };
      });
    },
    []
  );

  React.useEffect(() => {
    const next = config?.pref ?? "";
    setPrefDraft(next);
    setBaselinePref(next);
  }, [config?.pref]);

  const prefDirty = prefDraft !== baselinePref;
  const ruleBaseDirty = React.useMemo(
    () =>
      RULE_BASE_TARGETS.some((target) => {
        const entry = ruleBases[target.key];
        return entry ? entry.content !== entry.baseline : false;
      }),
    [ruleBases]
  );
  const hasDirty = prefDirty || ruleBaseDirty;

  React.useEffect(() => {
    onDirtyChange?.(hasDirty);
  }, [hasDirty, onDirtyChange]);

  const handlePrefChange = React.useCallback(
    (value: string) => {
      setPrefDraft(value);
    },
    []
  );

  const discardPref = React.useCallback(async () => {
    setPrefDraft(baselinePref);
  }, [baselinePref]);

  const loadRuleBase = React.useCallback(
    async (key: RuleBaseKey) => {
      updateRuleBaseState(key, { loading: true, error: null });
      try {
        const data = await fetchJson<FileContentResponse>(
          `/api/config/rule-base/${key}`
        );
        updateRuleBaseState(key, {
          content: data.content,
          baseline: data.content,
          path: data.path,
          loading: false,
          error: null,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to load rule base";
        updateRuleBaseState(key, { loading: false, error: message });
        onStatus({ kind: "error", message });
      }
    },
    [onStatus, updateRuleBaseState]
  );

  const reloadRuleBases = React.useCallback(() => {
    for (const target of RULE_BASE_TARGETS) {
      void loadRuleBase(target.key);
    }
  }, [loadRuleBase]);

  React.useEffect(() => {
    reloadRuleBases();
  }, [reloadRuleBases]);

  const savePref = React.useCallback(async (): Promise<boolean> => {
    if (!config) {
      return true;
    }
    setPrefSaving(true);
    try {
      await fetchJson<UpdateFileResponse>("/api/config/pref", {
        method: "PUT",
        body: JSON.stringify({ content: prefDraft }),
      });
      setBaselinePref(prefDraft);
      onStatus({ kind: "ok", message: "pref.toml saved and reloaded." });
      await onReload();
      reloadRuleBases();
      return true;
    } catch (err) {
      onStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Save failed",
      });
      return false;
    } finally {
      setPrefSaving(false);
    }
  }, [config, onReload, onStatus, prefDraft, reloadRuleBases]);

  const saveRuleBase = React.useCallback(
    async (key: RuleBaseKey, content: string): Promise<boolean> => {
      updateRuleBaseState(key, { saving: true, error: null });
      try {
        const response = await fetchJson<UpdateFileResponse>(
          `/api/config/rule-base/${key}`,
          {
            method: "PUT",
            body: JSON.stringify({ content }),
          }
        );
        updateRuleBaseState(key, {
          content,
          baseline: content,
          path: response.path,
          saving: false,
          error: null,
        });
        const label =
          RULE_BASE_TARGETS.find((target) => target.key === key)?.label ?? key;
        onStatus({ kind: "ok", message: `${label} saved` });
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Save failed";
        updateRuleBaseState(key, { saving: false, error: message });
        onStatus({ kind: "error", message });
        return false;
      }
    },
    [onStatus, updateRuleBaseState]
  );

  const handleRuleBaseChange = React.useCallback(
    (key: RuleBaseKey, value: string) => {
      updateRuleBaseState(key, { content: value });
    },
    [updateRuleBaseState]
  );

  const discardRuleBase = React.useCallback((key: RuleBaseKey) => {
    setRuleBases((prev) => {
      const current = prev[key];
      if (!current) {
        return prev;
      }
      return {
        ...prev,
        [key]: { ...current, content: current.baseline, error: null },
      };
    });
  }, []);

  const handleReload = React.useCallback(async () => {
    try {
      await onReload();
      reloadRuleBases();
    } catch (err) {
      onStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Refresh failed",
      });
    }
  }, [onReload, onStatus, reloadRuleBases]);

  React.useEffect(() => {
    if (!onRegisterSave) {
      return;
    }
    onRegisterSave(async () => {
      let ok = true;
      for (const target of RULE_BASE_TARGETS) {
        const entry = ruleBases[target.key];
        if (entry && entry.content !== entry.baseline) {
          ok = (await saveRuleBase(target.key, entry.content)) && ok;
        }
      }
      if (prefDirty) {
        ok = (await savePref()) && ok;
      }
      return ok;
    });
  }, [onRegisterSave, prefDirty, ruleBases, savePref, saveRuleBase]);

  React.useEffect(() => {
    if (!onRegisterDiscard) {
      return;
    }
    onRegisterDiscard(async () => {
      setPrefDraft(baselinePref);
      setRuleBases((prev) => {
        const next = { ...prev };
        for (const target of RULE_BASE_TARGETS) {
          const current = prev[target.key];
          if (!current) {
            continue;
          }
          next[target.key] = {
            ...current,
            content: current.baseline,
            error: null,
          };
        }
        return next;
      });
    });
  }, [baselinePref, onRegisterDiscard]);

  const editorReadOnly = loading || prefSaving || !config;

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
            onClick={() => void handleReload()}
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
          <CardDescription>Edit here and save to apply changes.</CardDescription>
        </CardHeader>
        <CardContent>
          <CodeEditor
            value={prefDraft}
            language="toml"
            readOnly={editorReadOnly}
            height="440px"
            className="overflow-hidden rounded-2xl border border-border/60 bg-muted/30"
            onChange={handlePrefChange}
          />
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2">
          <Button
            onClick={() => void savePref()}
            disabled={prefSaving || loading || !prefDirty || !config}
          >
            {prefSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save
          </Button>
          <Button
            variant="outline"
            onClick={() => void discardPref()}
            disabled={!prefDirty}
          >
            <RefreshCw className="h-4 w-4" />
            Revert
          </Button>
        </CardFooter>
      </Card>

      <Card className="animate-[fade-in_0.7s_ease_forwards] lg:col-span-2">
        <CardHeader>
          <CardTitle>Rule Base Configs</CardTitle>
          <CardDescription>
            Edit clash.yml and surge.cfg base files referenced by pref.toml.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs
            value={activeRuleBase}
            onValueChange={(value) => setActiveRuleBase(value as RuleBaseKey)}
          >
            <TabsList>
              {RULE_BASE_TARGETS.map((target) => (
                <TabsTrigger key={target.key} value={target.key} className="gap-2">
                  {target.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {RULE_BASE_TARGETS.map((target) => {
              const entry = ruleBases[target.key];
              const dirty = entry.content !== entry.baseline;
              const filePath = entry.path ?? "Path not resolved";
              const language = languageForFile(filePath);
              return (
                <TabsContent key={target.key} value={target.key} className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <p>{target.description}</p>
                    <p className="rounded-2xl bg-muted/40 px-3 py-2">{filePath}</p>
                  </div>
                  {entry.error && (
                    <p className="text-xs text-rose-500">{entry.error}</p>
                  )}
                  {entry.loading ? (
                    <div className="rounded-2xl border border-dashed border-border/60 bg-muted/40 px-4 py-6 text-xs text-muted-foreground">
                      Loading {target.label}...
                    </div>
                  ) : (
                    <CodeEditor
                      value={entry.content}
                      language={language}
                      height="360px"
                      readOnly={entry.saving}
                      onChange={(value) => handleRuleBaseChange(target.key, value)}
                      className="rounded-2xl border border-border/60 bg-muted/30"
                    />
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => void saveRuleBase(target.key, entry.content)}
                      disabled={entry.loading || entry.saving || !dirty}
                    >
                      {entry.saving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4" />
                      )}
                      Save {target.label}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => discardRuleBase(target.key)}
                      disabled={!dirty}
                    >
                      <RefreshCw className="h-4 w-4" />
                      Revert
                    </Button>
                  </div>
                </TabsContent>
              );
            })}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
