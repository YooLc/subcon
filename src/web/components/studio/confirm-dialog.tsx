"use client";

import * as React from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type ConfirmOptions = {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type ConfirmState = ConfirmOptions & { open: boolean };

export function useConfirmDialog() {
  const [state, setState] = React.useState<ConfirmState>({
    open: false,
    title: "",
  });
  const resolverRef = React.useRef<((value: boolean) => void) | null>(null);

  const close = React.useCallback((value: boolean) => {
    if (resolverRef.current) {
      resolverRef.current(value);
      resolverRef.current = null;
    }
    setState((prev) => ({ ...prev, open: false }));
  }, []);

  const confirm = React.useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      if (resolverRef.current) {
        resolverRef.current(false);
      }
      resolverRef.current = resolve;
      setState({ open: true, ...options });
    });
  }, []);

  const handleOpenChange = React.useCallback(
    (open: boolean) => {
      if (!open) {
        close(false);
      }
    },
    [close]
  );

  const confirmLabel =
    state.confirmLabel ?? (state.destructive ? "Delete" : "Continue");
  const cancelLabel = state.cancelLabel ?? "Cancel";

  const ConfirmDialog = (
    <Dialog open={state.open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{state.title}</DialogTitle>
          {state.description ? (
            <DialogDescription className="whitespace-pre-line">
              {state.description}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => close(false)}>
            {cancelLabel}
          </Button>
          <Button
            variant={state.destructive ? "destructive" : "default"}
            onClick={() => close(true)}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );

  return { confirm, ConfirmDialog };
}
