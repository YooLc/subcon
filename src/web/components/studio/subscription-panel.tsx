"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ConfigResponse } from "@/components/studio/types";

type SubscriptionPanelProps = {
  config: ConfigResponse | null;
};

export function SubscriptionPanel({ config }: SubscriptionPanelProps) {
  const [originUrl, setOriginUrl] = React.useState("");
  const [target, setTarget] = React.useState("clash");
  const [token, setToken] = React.useState("");
  const [copied, setCopied] = React.useState(false);
  const copyTimeoutRef = React.useRef<number | null>(null);

  const baseUrl = React.useMemo(() => {
    if (config?.managed_base_url) {
      return config.managed_base_url;
    }
    if (typeof window !== "undefined") {
      return window.location.origin;
    }
    return "";
  }, [config?.managed_base_url]);

  const finalUrl = React.useMemo(() => {
    if (!baseUrl) {
      return "";
    }
    const trimmed = baseUrl.replace(/\/$/, "");
    const params = new URLSearchParams();
    params.set("target", target);
    if (token.trim() !== "") {
      params.set("token", token.trim());
    }
    if (originUrl.trim() !== "") {
      params.set("url", originUrl.trim());
    }
    return `${trimmed}/sub?${params.toString()}`;
  }, [baseUrl, originUrl, target, token]);

  const handleCopy = React.useCallback(async () => {
    if (!finalUrl) {
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(finalUrl);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = finalUrl;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopied(true);
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = window.setTimeout(() => {
        setCopied(false);
        copyTimeoutRef.current = null;
      }, 2000);
    } catch {
      setCopied(false);
    }
  }, [finalUrl]);

  React.useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  return (
    <Card className="animate-[fade-in_0.5s_ease_forwards]">
      <CardHeader>
        <CardTitle>Subscription Builder</CardTitle>
        <CardDescription>Generate subscription URLs on the fly.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Base URL</p>
          <Input value={baseUrl} readOnly />
        </div>
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Target</p>
          <select
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            className="h-10 w-full rounded-2xl border border-border/60 bg-background/70 px-4 py-2 text-sm text-foreground shadow-sm backdrop-blur outline-none transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <option value="clash">clash</option>
            <option value="surge">surge</option>
          </select>
        </div>
        <div className="space-y-2 lg:col-span-2">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Origin URL (optional)
          </p>
          <Input
            value={originUrl}
            onChange={(event) => setOriginUrl(event.target.value)}
            placeholder="https://example.com/sub"
          />
        </div>
        <div className="space-y-2 lg:col-span-2">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Token (optional)
          </p>
          <Input
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="token"
          />
        </div>
        <div className="space-y-2 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Final URL
            </p>
            <Button
              type="button"
              size="sm"
              variant="subtle"
              onClick={() => void handleCopy()}
              disabled={!finalUrl}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <Textarea value={finalUrl} readOnly className="min-h-[120px]" />
        </div>
      </CardContent>
    </Card>
  );
}
