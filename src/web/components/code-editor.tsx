"use client";

import dynamic from "next/dynamic";
import * as React from "react";
import { useTheme } from "next-themes";
import type { Monaco } from "@monaco-editor/react";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
});

let tomlRegistered = false;

function registerToml(monaco: Monaco): void {
  if (tomlRegistered) {
    return;
  }
  const existing = monaco.languages
    .getLanguages()
    .some((lang: { id: string }) => lang.id === "toml");
  if (!existing) {
    monaco.languages.register({ id: "toml" });
  }
  monaco.languages.setMonarchTokensProvider("toml", {
    tokenizer: {
      root: [
        [/^\\s*#.*/, "comment"],
        [/\\[\\[.*?\\]\\]/, "tag"],
        [/\\[.*?\\]/, "tag"],
        [/"([^"\\\\]|\\\\.)*"/, "string"],
        [/'([^'\\\\]|\\\\.)*'/, "string"],
        [/\\b(true|false)\\b/, "keyword"],
        [
          /\\b\\d{4}-\\d{2}-\\d{2}(?:[Tt ]\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})?)?\\b/,
          "number",
        ],
        [/[+-]?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?/, "number"],
        [/[A-Za-z0-9_\\-]+(?=\\s*=)/, "identifier"],
      ],
    },
  });
  monaco.languages.setLanguageConfiguration("toml", {
    comments: { lineComment: "#" },
    brackets: [
      ["{", "}"],
      ["[", "]"],
      ["(", ")"],
    ],
    autoClosingPairs: [
      { open: "[", close: "]" },
      { open: "{", close: "}" },
      { open: "(", close: ")" },
      { open: "\"", close: "\"" },
      { open: "'", close: "'" },
    ],
  });
  tomlRegistered = true;
}

type CodeEditorProps = {
  value: string;
  language: string;
  onChange?: (value: string) => void;
  className?: string;
  readOnly?: boolean;
  height?: string;
};

export function CodeEditor({
  value,
  language,
  onChange,
  className,
  readOnly = false,
  height,
}: CodeEditorProps) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const theme = resolvedTheme === "dark" ? "vs-dark" : "vs";
  const editorHeight = height ?? "420px";
  const handleBeforeMount = React.useCallback((monaco: Monaco) => {
    registerToml(monaco);
  }, []);

  if (!mounted) {
    return <div className={className} style={{ height: editorHeight }} />;
  }

  return (
    <MonacoEditor
      value={value}
      language={language}
      theme={theme}
      height={editorHeight}
      className={className}
      beforeMount={handleBeforeMount}
      options={{
        minimap: { enabled: false },
        fontSize: 13,
        fontFamily: "var(--font-mono)",
        lineNumbers: "on",
        scrollBeyondLastLine: false,
        wordWrap: "on",
        readOnly,
      }}
      onChange={(next) => onChange?.(next ?? "")}
      loading={
        <div
          className="flex items-center justify-center rounded-2xl border border-border/60 bg-muted/30 text-sm text-muted-foreground"
          style={{ height: editorHeight }}
        >
          Loading editor...
        </div>
      }
    />
  );
}
