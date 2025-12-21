"use client";

import dynamic from "next/dynamic";
import * as React from "react";
import { useTheme } from "next-themes";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
});

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
