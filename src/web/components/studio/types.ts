export type StatusKind = "ok" | "error" | "info";

export type Status = {
  kind: StatusKind;
  message: string;
};

export type PanelProps = {
  onStatus: (status: Status) => void;
};

export type FileEntry = {
  name: string;
  path: string;
  in_use?: boolean;
  usage?: string[];
};

export type FileListResponse = {
  items: FileEntry[];
};

export type FileContentResponse = {
  name: string;
  path: string;
  content: string;
};

export type ConfigResponse = {
  version: string;
  pref_path: string;
  pref: string;
  schema_dir: string;
  profiles_dir: string;
  rules_dir: string;
  rulesets: string[];
  managed_base_url?: string | null;
  api_auth_required: boolean;
  server: {
    listen: string;
    port: number;
  };
};

export type UpdateFileResponse = {
  ok: boolean;
  path: string;
  bytes: number;
};

export type LogResponse = {
  items: string[];
};

export type GroupEntry = {
  name: string;
  group_type: string;
  rules: string[];
  url?: string | null;
  interval?: number | null;
  rulesets: string[];
};

export type GroupResponse = {
  items: GroupEntry[];
};

export type CacheEntry = {
  url: string;
  ttl_seconds: number;
};

export type CacheResponse = {
  items: CacheEntry[];
};

export type ProxyFieldKind = "string" | "number" | "boolean" | "array" | "object" | "null";

export type ProxyField = {
  key: string;
  kind: ProxyFieldKind;
  value: unknown;
  raw: string;
  editable: boolean;
};

export type ProxyItem = {
  id: string;
  name: string;
  type: string;
  server: string;
  port: string;
  fields: ProxyField[];
};

export type ProfileState = {
  base: Record<string, unknown>;
  proxies: ProxyItem[];
};

export type SchemaCell = {
  to: string;
  optional: boolean;
  defaultValue: string;
};

export type SchemaTargetState = {
  name: string;
  mappings: Record<string, SchemaCell>;
  extraTemplate: Record<string, unknown>;
  raw: Record<string, unknown>;
};

export type SchemaState = {
  protocol: string;
  fields: string[];
  targets: SchemaTargetState[];
  raw: Record<string, unknown>;
};
