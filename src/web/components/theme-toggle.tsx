"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <div className="flex items-center gap-3 rounded-full border border-border/60 bg-card/70 px-4 py-2 shadow-sm backdrop-blur">
      <Sun className={cn("h-4 w-4", isDark ? "text-muted-foreground" : "text-primary")} />
      <Switch checked={isDark} onCheckedChange={(val) => setTheme(val ? "dark" : "light")} />
      <Moon className={cn("h-4 w-4", isDark ? "text-primary" : "text-muted-foreground")} />
    </div>
  );
}
