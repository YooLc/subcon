"use client";

import * as React from "react";
import YAML from "yaml";
import {
  Code2,
  Hash,
  LayoutGrid,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Server,
  Tag,
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { fetchJson } from "@/components/studio/api";
import { languageForFile } from "@/components/studio/utils";
import type {
  FileContentResponse,
  FileEntry,
  FileListResponse,
  GroupEntry,
  GroupResponse,
  PanelProps,
  ProfileState,
  ProxyField,
  ProxyFieldKind,
  ProxyItem,
  UpdateGroupMembersRequest,
  UpdateGroupMembersResponse,
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

const PROFILE_FILE_EXTS = ["yaml", "yml"];
const DEFAULT_PROFILE_EXTENSION = "yaml";
const DEFAULT_PROFILE_CONTENT = "proxies: []\n";

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
  if (Array.isArray(value)) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  if (typeof value === "object") {
    try {
      return YAML.stringify(value, { indent: 2 }).trim();
    } catch {
      return String(value);
    }
  }
  try {
    const serialized = YAML.stringify(value, { indent: 2 }).trim();
    return serialized;
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
        const editable = true;
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
      groups: [],
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

function applyGroupSelections(state: ProfileState, groups: GroupEntry[]): ProfileState {
  if (groups.length === 0) {
    return state;
  }
  const rulesByGroup = new Map(
    groups.map((group) => [group.name, group.rules ?? []])
  );
  return {
    ...state,
    proxies: state.proxies.map((proxy) => {
      const selected = Array.from(rulesByGroup.entries())
        .filter(([, rules]) => rules.some((rule) => rule === proxy.name))
        .map(([name]) => name);
      return {
        ...proxy,
        groups: selected,
      };
    }),
  };
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
    case "array":
    case "object": {
      if (raw.trim() === "") {
        return raw;
      }
      try {
        return YAML.parse(raw);
      } catch {
        return raw;
      }
    }
    default:
      return raw;
  }
}

function parseRawValue(kind: ProxyFieldKind, raw: string): unknown {
  if (raw.trim() === "") {
    return raw;
  }
  switch (kind) {
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
    case "array":
    case "object":
      try {
        return YAML.parse(raw);
      } catch {
        return raw;
      }
    case "null":
      return raw === "" ? null : raw;
    default:
      return raw;
  }
}

type NewProxyField = {
  key: string;
  kind: ProxyFieldKind;
  value: string;
};

export function ProfilesPanel({
  onStatus,
  onDirtyChange,
  onRegisterSave,
  onRegisterDiscard,
}: PanelProps) {
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
  const [schemaItems, setSchemaItems] = React.useState<FileEntry[]>([]);
  const [schemaAllItems, setSchemaAllItems] = React.useState<FileEntry[]>([]);
  const [schemaLoading, setSchemaLoading] = React.useState(false);
  const [schemaError, setSchemaError] = React.useState<string | null>(null);
  const [groupEntries, setGroupEntries] = React.useState<GroupEntry[]>([]);
  const [groupLoading, setGroupLoading] = React.useState(false);
  const [groupError, setGroupError] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [createName, setCreateName] = React.useState("");
  const [createError, setCreateError] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [newProxyOpen, setNewProxyOpen] = React.useState(false);
  const [newProxyType, setNewProxyType] = React.useState("");
  const [newProxyName, setNewProxyName] = React.useState("");
  const [newProxyServer, setNewProxyServer] = React.useState("");
  const [newProxyPort, setNewProxyPort] = React.useState("");
  const [newProxyFields, setNewProxyFields] = React.useState<NewProxyField[]>([]);
  const [newProxyError, setNewProxyError] = React.useState<string | null>(null);
  const [schemaFieldLoading, setSchemaFieldLoading] = React.useState(false);
  const [newProxyMode, setNewProxyMode] = React.useState<"form" | "editor">("form");
  const [newProxyYaml, setNewProxyYaml] = React.useState("");
  const selectedNameRef = React.useRef<string | null>(null);
  const groupTouchedRef = React.useRef(false);
  const groupSeededRef = React.useRef(false);
  const schemaFieldDefsRef = React.useRef<Map<string, NewProxyField[]>>(new Map());
  const userTypeChangeRef = React.useRef(false);

  React.useEffect(() => {
    selectedNameRef.current = selectedName;
  }, [selectedName]);

  React.useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const buildGroupUpdates = React.useCallback((state: ProfileState) => {
    const map = new Map<string, Set<string>>();
    state.proxies.forEach((proxy) => {
      const groups = proxy.groups ?? [];
      groups.forEach((group) => {
        const trimmed = group.trim();
        if (!trimmed) {
          return;
        }
        if (!map.has(trimmed)) {
          map.set(trimmed, new Set());
        }
        map.get(trimmed)?.add(proxy.name);
      });
    });
    const items = Array.from(map.entries()).map(([group, proxies]) => ({
      group,
      proxies: Array.from(proxies),
    }));
    const payload: UpdateGroupMembersRequest = { items };
    return payload;
  }, []);

  const loadItem = React.useCallback(
    async (name: string) => {
      setLoadingItem(true);
      setSelectedName(name);
      groupTouchedRef.current = false;
      groupSeededRef.current = false;
      try {
        const data = await fetchJson<FileContentResponse>(
          `/api/profiles/${encodeURIComponent(name)}`
        );
        setSelectedPath(data.path);
        setContent(data.content);
        setParseError(null);
        try {
          let parsed = parseProfile(data.content);
          if (groupEntries.length > 0 && !groupTouchedRef.current) {
            parsed = applyGroupSelections(parsed, groupEntries);
            groupSeededRef.current = true;
          }
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
    [groupEntries, onStatus]
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

  React.useEffect(() => {
    if (
      !profileState ||
      groupEntries.length === 0 ||
      groupTouchedRef.current ||
      groupSeededRef.current
    ) {
      return;
    }
    setProfileState((prev) => (prev ? applyGroupSelections(prev, groupEntries) : prev));
    groupSeededRef.current = true;
  }, [groupEntries, profileState]);

  const loadGroups = React.useCallback(async () => {
    setGroupLoading(true);
    setGroupError(null);
    try {
      const data = await fetchJson<GroupResponse>("/api/groups");
      setGroupEntries(data.items);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load groups";
      setGroupError(message);
      onStatus({ kind: "error", message });
    } finally {
      setGroupLoading(false);
    }
  }, [onStatus]);

  React.useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  const handleSave = React.useCallback(async (): Promise<boolean> => {
    if (!selectedName) {
      return true;
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
      let groupMessage = "";
      if (mode === "friendly" && profileState) {
        const groupPayload = buildGroupUpdates(profileState);
        if (groupPayload.items.length > 0) {
          try {
            const response = await fetchJson<UpdateGroupMembersResponse>(
              "/api/groups/members",
              {
                method: "POST",
                body: JSON.stringify(groupPayload),
              }
            );
            await loadGroups();
            const updated = response.updated.join(", ");
            const missing = response.missing.join(", ");
            if (updated) {
              groupMessage = ` Groups updated: ${updated}.`;
            }
            if (missing) {
              groupMessage += ` Missing groups: ${missing}.`;
            }
          } catch (err) {
            const message =
              err instanceof Error ? err.message : "Failed to update groups";
            onStatus({
              kind: "error",
              message: `${selectedName} saved, but ${message}`,
            });
            return false;
          }
        }
      }
      onStatus({ kind: "ok", message: `${selectedName} saved.${groupMessage}` });
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
  }, [
    buildGroupUpdates,
    content,
    loadGroups,
    mode,
    onStatus,
    profileState,
    selectedName,
  ]);

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

  const loadSchemaList = React.useCallback(async () => {
    setSchemaLoading(true);
    setSchemaError(null);
    try {
      const data = await fetchJson<FileListResponse>("/api/schema");
      const filtered = data.items.filter((item) => !item.name.includes("include/"));
      setSchemaAllItems(data.items);
      setSchemaItems(filtered);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load schema list";
      setSchemaError(message);
      onStatus({ kind: "error", message });
    } finally {
      setSchemaLoading(false);
    }
  }, [onStatus]);

  React.useEffect(() => {
    void loadSchemaList();
  }, [loadSchemaList]);

  const schemaTypeOptions = React.useMemo(() => {
    const types = schemaItems
      .map((item) => item.name.split("/").pop() ?? "")
      .map((name) => name.replace(/\.ya?ml$/i, ""))
      .filter(Boolean);
    return Array.from(new Set(types));
  }, [schemaItems]);

  const schemaFileMap = React.useMemo(() => {
    const map = new Map<string, string>();
    schemaAllItems.forEach((item) => {
      const name = item.name.split("/").pop() ?? "";
      const type = name.replace(/\.ya?ml$/i, "");
      if (type && !map.has(type)) {
        map.set(type, item.name);
      }
    });
    return map;
  }, [schemaAllItems]);

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
      finalName = `${trimmed}.${DEFAULT_PROFILE_EXTENSION}`;
    } else if (!PROFILE_FILE_EXTS.includes(ext)) {
      setCreateError("Use .yaml or .yml.");
      return;
    }
    setCreating(true);
    try {
      const payload = DEFAULT_PROFILE_CONTENT;
      const response = await fetchJson<UpdateFileResponse>(
        `/api/profiles/${encodeURIComponent(finalName)}`,
        {
          method: "PUT",
          body: JSON.stringify({ content: payload }),
        }
      );
      setSelectedName(finalName);
      selectedNameRef.current = finalName;
      setSelectedPath(response.path);
      setContent(payload);
      setProfileState(parseProfile(payload));
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
  }, [createName, loadList, onStatus, resetCreateForm]);

  const getDefaultProxyType = React.useCallback(() => {
    return schemaTypeOptions[0] ?? COMMON_PROXY_TYPES[0] ?? "ss";
  }, [schemaTypeOptions]);

  const resetNewProxyForm = React.useCallback(() => {
    const defaultType = getDefaultProxyType();
    userTypeChangeRef.current = false;
    setNewProxyType(defaultType);
    setNewProxyName("");
    setNewProxyServer("");
    setNewProxyPort("");
    setNewProxyFields([]);
    setNewProxyError(null);
    setNewProxyMode("form");
    setNewProxyYaml("");
  }, [getDefaultProxyType]);

  const handleNewProxyOpenChange = React.useCallback(
    (open: boolean) => {
      setNewProxyOpen(open);
      if (open) {
        resetNewProxyForm();
      } else {
        setNewProxyError(null);
        setSchemaFieldLoading(false);
      }
    },
    [resetNewProxyForm]
  );

  React.useEffect(() => {
    if (!newProxyOpen || !newProxyType) {
      return;
    }
    let mounted = true;
    const loadFields = async (protocol: string, visited: Set<string>) => {
      if (visited.has(protocol)) {
        return {};
      }
      visited.add(protocol);
      const normalized = protocol === "ss" ? "shadowsocks" : protocol;
      const fileName = schemaFileMap.get(normalized);
      if (!fileName) {
        return {};
      }
      const data = await fetchJson<FileContentResponse>(
        `/api/schema/${encodeURI(fileName)}`
      );
      const raw = (YAML.parse(data.content) ?? {}) as Record<string, unknown>;
      const includes = Array.isArray(raw.includes)
        ? raw.includes.filter((value): value is string => typeof value === "string")
        : [];
      const combined: Record<string, unknown> = {};
      for (const include of includes) {
        const includeFields = await loadFields(include, visited);
        Object.entries(includeFields).forEach(([key, value]) => {
          if (!(key in combined)) {
            combined[key] = value;
          }
        });
      }
      const fieldsObject = (raw.fields ?? {}) as Record<string, unknown>;
      Object.entries(fieldsObject).forEach(([key, value]) => {
        combined[key] = value;
      });
      return combined;
    };

    setSchemaFieldLoading(true);
    loadFields(newProxyType, new Set())
      .then((fieldsObject) => {
        if (!mounted) {
          return;
        }
        const ignored = new Set(["name", "server", "port", "type"]);
        const fields = Object.entries(fieldsObject)
          .filter(([key]) => !ignored.has(key))
          .map(([key, value]) => {
            let rawType = "";
            if (typeof value === "string") {
              rawType = value;
            } else if (value && typeof value === "object") {
              const candidate = (value as Record<string, unknown>).type;
              if (typeof candidate === "string") {
                rawType = candidate;
              }
            }
            const normalized = rawType.toLowerCase();
            let kind: ProxyFieldKind = "string";
            if (normalized === "boolean") {
              kind = "boolean";
            } else if (normalized === "integer" || normalized === "number") {
              kind = "number";
            } else if (normalized === "array" || normalized === "list") {
              kind = "array";
            } else if (normalized === "object" || normalized === "map") {
              kind = "object";
            }
            return { key, kind, value: "" };
          });
        schemaFieldDefsRef.current.set(newProxyType, fields);
        setNewProxyFields((prev) => {
          if (userTypeChangeRef.current) {
            return fields;
          }
          const prevMap = new Map(prev.map((field) => [field.key, field]));
          const next: NewProxyField[] = fields.map((field) => ({
            ...field,
            value: prevMap.get(field.key)?.value ?? "",
          }));
          prev.forEach((field) => {
            if (!next.find((nextField) => nextField.key === field.key)) {
              next.push(field);
            }
          });
          return next;
        });
      })
      .catch((err) => {
        if (!mounted) {
          return;
        }
        const message = err instanceof Error ? err.message : "Failed to load schema";
        setNewProxyError(message);
      })
      .finally(() => {
        if (mounted) {
          setSchemaFieldLoading(false);
          userTypeChangeRef.current = false;
        }
      });
    return () => {
      mounted = false;
    };
  }, [newProxyOpen, newProxyType, schemaFileMap]);

  const updateNewProxyField = React.useCallback((key: string, value: string) => {
    setNewProxyFields((prev) =>
      prev.map((field) => (field.key === key ? { ...field, value } : field))
    );
  }, []);

  const buildProxyObjectFromForm = React.useCallback(() => {
    const output: Record<string, unknown> = {};
    const name = newProxyName.trim();
    const type = newProxyType.trim();
    const server = newProxyServer.trim();
    const port = newProxyPort.trim();
    if (name) {
      output.name = name;
    }
    if (type) {
      output.type = type;
    }
    if (server) {
      output.server = server;
    }
    if (port) {
      const parsedPort = Number(port);
      output.port = Number.isFinite(parsedPort) ? parsedPort : port;
    }
    newProxyFields.forEach((field) => {
      const raw = field.value;
      if (raw.trim() === "") {
        return;
      }
      output[field.key] = parseRawValue(field.kind, raw);
    });
    return output;
  }, [newProxyFields, newProxyName, newProxyPort, newProxyServer, newProxyType]);

  const applyProxyObjectToForm = React.useCallback(
    (value: Record<string, unknown>) => {
      userTypeChangeRef.current = false;
      const name = typeof value.name === "string" ? value.name : "";
      const type = typeof value.type === "string" ? value.type : getDefaultProxyType();
      const server = value.server ? String(value.server) : "";
      const port = value.port !== undefined ? String(value.port) : "";
      const baseFields =
        schemaFieldDefsRef.current.get(type) ?? newProxyFields ?? [];
      const baseMap = new Map(
        baseFields.map((field) => [field.key, { ...field, value: "" }])
      );
      Object.entries(value)
        .filter(([key]) => !["name", "type", "server", "port"].includes(key))
        .forEach(([key, fieldValue]) => {
          const formatted = formatFieldValue(fieldValue);
          const existing = baseMap.get(key);
          if (existing) {
            baseMap.set(key, { ...existing, value: formatted });
          } else {
            baseMap.set(key, {
              key,
              kind: detectFieldKind(fieldValue),
              value: formatted,
            });
          }
        });
      setNewProxyName(name);
      setNewProxyType(type);
      setNewProxyServer(server);
      setNewProxyPort(port);
      setNewProxyFields(Array.from(baseMap.values()));
    },
    [getDefaultProxyType, newProxyFields]
  );

  const handleProxyModeChange = React.useCallback(
    (next: "form" | "editor") => {
      if (next === newProxyMode) {
        return;
      }
      if (next === "editor") {
        const payload = buildProxyObjectFromForm();
        setNewProxyYaml(YAML.stringify(payload, { indent: 2 }));
        setNewProxyError(null);
        setNewProxyMode("editor");
        return;
      }
      try {
        const parsed = YAML.parse(newProxyYaml) as Record<string, unknown>;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("Proxy must be a YAML object.");
        }
        applyProxyObjectToForm(parsed);
        setNewProxyError(null);
        setNewProxyMode("form");
      } catch (err) {
        setNewProxyError(err instanceof Error ? err.message : "Invalid YAML");
      }
    },
    [
      applyProxyObjectToForm,
      buildProxyObjectFromForm,
      newProxyMode,
      newProxyYaml,
    ]
  );

  const handleAddProxy = React.useCallback(() => {
    if (!profileState) {
      setNewProxyError("Load a profile first.");
      return;
    }
    let payload: Record<string, unknown>;
    if (newProxyMode === "editor") {
      try {
        const parsed = YAML.parse(newProxyYaml) as Record<string, unknown>;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("Proxy must be a YAML object.");
        }
        payload = parsed;
      } catch (err) {
        setNewProxyError(err instanceof Error ? err.message : "Invalid YAML");
        return;
      }
    } else {
      payload = buildProxyObjectFromForm();
    }

    const name =
      typeof payload.name === "string"
        ? payload.name.trim()
        : `Proxy ${profileState.proxies.length + 1}`;
    const type = typeof payload.type === "string" ? payload.type.trim() : "";
    if (!type) {
      setNewProxyError("Select a proxy type.");
      return;
    }
    const server = payload.server ? String(payload.server).trim() : "";
    const port = payload.port !== undefined ? String(payload.port).trim() : "";
    const fields = Object.entries(payload)
      .filter(([key]) => !["name", "type", "server", "port"].includes(key))
      .map(([key, value]) => ({
        key,
        kind: detectFieldKind(value),
        value,
        raw: formatFieldValue(value),
        editable: true,
      }));

    const nextProxy: ProxyItem = {
      id: `${Date.now()}-${name}`,
      name,
      type,
      server,
      port,
      fields,
      groups: [],
    };

    setProfileState((prev) => {
      if (!prev) {
        return prev;
      }
      return {
        ...prev,
        proxies: [...prev.proxies, nextProxy],
      };
    });
    setDirty(true);
    setNewProxyOpen(false);
    setNewProxyError(null);
  }, [
    buildProxyObjectFromForm,
    newProxyMode,
    newProxyYaml,
    profileState,
  ]);

  const typeOptions = React.useMemo(() => {
    const fromProxies = profileState?.proxies.map((proxy) => proxy.type) ?? [];
    return Array.from(
      new Set([...schemaTypeOptions, ...COMMON_PROXY_TYPES, ...fromProxies])
    ).filter(Boolean);
  }, [profileState, schemaTypeOptions]);

  const newProxyTypeOptions = React.useMemo(() => {
    return schemaTypeOptions.length > 0 ? schemaTypeOptions : typeOptions;
  }, [schemaTypeOptions, typeOptions]);

  const groupOptions = React.useMemo(() => {
    return Array.from(new Set(groupEntries.map((group) => group.name)));
  }, [groupEntries]);

  React.useEffect(() => {
    if (!newProxyOpen || schemaTypeOptions.length === 0) {
      return;
    }
    if (!schemaTypeOptions.includes(newProxyType)) {
      setNewProxyType(schemaTypeOptions[0]);
    }
  }, [newProxyOpen, newProxyType, schemaTypeOptions]);

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

  const removeProxy = React.useCallback((proxyId: string) => {
    if (!window.confirm("Delete this proxy? This cannot be undone.")) {
      return;
    }
    setProfileState((prev) => {
      if (!prev) {
        return prev;
      }
      return {
        ...prev,
        proxies: prev.proxies.filter((proxy) => proxy.id !== proxyId),
      };
    });
    setDirty(true);
  }, []);


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
                  <DialogTitle>New profile</DialogTitle>
                  <DialogDescription>
                    Create a profile file (.yaml or .yml).
                  </DialogDescription>
                </DialogHeader>
                <div className="mt-4 space-y-3">
                  <Input
                    value={createName}
                    onChange={(event) => {
                      setCreateName(event.target.value);
                      setCreateError(null);
                    }}
                    placeholder={`profile.${DEFAULT_PROFILE_EXTENSION}`}
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
            <div className="flex flex-wrap items-center gap-2">
              <Dialog open={newProxyOpen} onOpenChange={handleNewProxyOpenChange}>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!profileState || mode !== "friendly"}
                  >
                    <Plus className="h-4 w-4" />
                    New proxy
                  </Button>
                </DialogTrigger>
                <DialogContent className="h-[80vh] max-w-2xl overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Add proxy</DialogTitle>
                    <DialogDescription>
                      Pick a type, then fill in the fields for the proxy.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="mt-4 space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant={newProxyMode === "form" ? "secondary" : "ghost"}
                        size="sm"
                        onClick={() => handleProxyModeChange("form")}
                      >
                        Form
                      </Button>
                      <Button
                        variant={newProxyMode === "editor" ? "secondary" : "ghost"}
                        size="sm"
                        onClick={() => handleProxyModeChange("editor")}
                      >
                        Editor
                      </Button>
                    </div>
                    {schemaError && (
                      <p className="text-xs text-rose-500">{schemaError}</p>
                    )}
                    {newProxyMode === "form" ? (
                      <>
                        <div className="space-y-2">
                          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                            Type
                          </p>
                          <select
                            value={newProxyType}
                            onChange={(event) => {
                              userTypeChangeRef.current = true;
                              setNewProxyType(event.target.value);
                              setNewProxyError(null);
                            }}
                            className="h-10 w-full rounded-2xl border border-border/60 bg-background/70 px-4 py-2 text-sm text-foreground shadow-sm backdrop-blur outline-none transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          >
                            {(newProxyType &&
                            !newProxyTypeOptions.includes(newProxyType)
                              ? [newProxyType, ...newProxyTypeOptions]
                              : newProxyTypeOptions
                            ).map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                          {schemaLoading && (
                            <p className="text-xs text-muted-foreground">
                              Loading schema types...
                            </p>
                          )}
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="space-y-2">
                            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                              Name
                            </p>
                            <Input
                              value={newProxyName}
                              onChange={(event) => {
                                setNewProxyName(event.target.value);
                                setNewProxyError(null);
                              }}
                              placeholder="Proxy name"
                            />
                          </div>
                          <div className="space-y-2">
                            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                              Server
                            </p>
                            <Input
                              value={newProxyServer}
                              onChange={(event) => {
                                setNewProxyServer(event.target.value);
                                setNewProxyError(null);
                              }}
                              placeholder="example.com"
                            />
                          </div>
                          <div className="space-y-2">
                            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                              Port
                            </p>
                            <Input
                              value={newProxyPort}
                              onChange={(event) => {
                                setNewProxyPort(event.target.value);
                                setNewProxyError(null);
                              }}
                              placeholder="443"
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                            Fields
                          </p>
                          {schemaFieldLoading ? (
                            <div className="rounded-2xl border border-dashed border-border/60 bg-muted/40 px-4 py-6 text-xs text-muted-foreground">
                              Loading fields...
                            </div>
                          ) : newProxyFields.length === 0 ? (
                            <div className="rounded-2xl border border-dashed border-border/60 bg-muted/40 px-4 py-6 text-xs text-muted-foreground">
                              No schema fields found for this type.
                            </div>
                          ) : (
                            <div className="grid gap-3 md:grid-cols-2">
                              {newProxyFields.map((field) => (
                                <div key={field.key} className="space-y-2">
                                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                                    {field.key}
                                  </p>
                                  {field.kind === "object" ? (
                                    <Textarea
                                      value={field.value}
                                      onChange={(event) =>
                                        updateNewProxyField(
                                          field.key,
                                          event.target.value
                                        )
                                      }
                                      rows={2}
                                      placeholder="{}"
                                    />
                                  ) : (
                                    <Input
                                      value={field.value}
                                      onChange={(event) =>
                                        updateNewProxyField(
                                          field.key,
                                          event.target.value
                                        )
                                      }
                                      placeholder={field.kind === "array" ? "[]" : ""}
                                    />
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      <CodeEditor
                        value={newProxyYaml}
                        language="yaml"
                        height="320px"
                        onChange={(value) => {
                          setNewProxyYaml(value);
                          setNewProxyError(null);
                        }}
                        className="rounded-2xl border border-border/60 bg-muted/30"
                      />
                    )}
                    {newProxyError && (
                      <p className="text-xs text-rose-500">{newProxyError}</p>
                    )}
                    <Button onClick={handleAddProxy} disabled={!profileState}>
                      <Plus className="h-4 w-4" />
                      Add proxy
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
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
            <div className="space-y-4">
              {profileState?.proxies.map((proxy) => (
                <ProxyCard
                  key={proxy.id}
                  proxy={proxy}
                  typeOptions={typeOptions}
                  groupOptions={groupOptions}
                  groupLoading={groupLoading}
                  groupError={groupError}
                  onGroupTouched={() => {
                    groupTouchedRef.current = true;
                  }}
                  onChange={(next) => updateProxy(proxy.id, () => next)}
                  onDelete={() => removeProxy(proxy.id)}
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
      </Card>
    </div>
  );
}

type ProxyCardProps = {
  proxy: ProxyItem;
  typeOptions: string[];
  groupOptions: string[];
  groupLoading: boolean;
  groupError: string | null;
  onGroupTouched: () => void;
  onChange: (proxy: ProxyItem) => void;
  onDelete: () => void;
};

function ProxyCard({
  proxy,
  typeOptions,
  groupOptions,
  groupLoading,
  groupError,
  onGroupTouched,
  onChange,
  onDelete,
}: ProxyCardProps) {
  const [editingName, setEditingName] = React.useState(false);

  const updateField = (key: string, value: string) => {
    onChange({
      ...proxy,
      fields: proxy.fields.map((field) =>
        field.key === key ? { ...field, raw: value } : field
      ),
    });
  };

  const selectedGroups = proxy.groups ?? [];
  const toggleGroup = (group: string) => {
    const next = selectedGroups.includes(group)
      ? selectedGroups.filter((name) => name !== group)
      : [...selectedGroups, group];
    onGroupTouched();
    onChange({
      ...proxy,
      groups: next,
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
        <div className="flex items-center gap-2">
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
          <Button variant="ghost" size="icon" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
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
            </div>
            {field.kind === "object" ? (
              <Textarea
                value={field.raw}
                onChange={(event) => updateField(field.key, event.target.value)}
                rows={2}
              />
            ) : (
              <Input
                value={field.raw}
                onChange={(event) => updateField(field.key, event.target.value)}
              />
            )}
          </div>
        ))}
      </div>
      <div className="mt-5 border-t border-border/60 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground">Groups</p>
            {selectedGroups.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {selectedGroups.map((group) => (
                  <Badge key={`${proxy.id}-${group}`} variant="outline">
                    {group}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No groups selected</p>
            )}
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                {groupLoading
                  ? "Loading..."
                  : groupError
                    ? "Groups error"
                    : groupOptions.length === 0
                      ? "No groups"
                      : selectedGroups.length > 0
                        ? `Groups (${selectedGroups.length})`
                        : "Add to groups"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72">
              {groupLoading ? (
                <p className="text-xs text-muted-foreground">Loading groups...</p>
              ) : groupError ? (
                <p className="text-xs text-rose-500">{groupError}</p>
              ) : groupOptions.length === 0 ? (
                <p className="text-xs text-muted-foreground">No groups available.</p>
              ) : (
                <div className="max-h-60 space-y-2 overflow-y-auto">
                  {groupOptions.map((group) => {
                    const checked = selectedGroups.includes(group);
                    return (
                      <label
                        key={`${proxy.id}-${group}`}
                        className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-muted/30 px-3 py-2 text-xs"
                      >
                        <span className="truncate">{group}</span>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleGroup(group)}
                          className="h-4 w-4 accent-primary"
                        />
                      </label>
                    );
                  })}
                </div>
              )}
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </div>
  );
}
