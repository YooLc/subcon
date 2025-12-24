"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SubscriptionPanel } from "@/components/studio/subscription-panel";

export default function SubscriptionPage() {
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        // No initialization needed - SubscriptionPanel will use current origin
        setLoading(false);
    }, []);

    return (
        <TooltipProvider>
            <div className="flex min-h-screen flex-col bg-background">
                {/* Header */}
                <header className="border-b border-border/40 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                    <div className="flex items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
                        <div className="flex items-center gap-2">
                            <h1 className="text-lg font-semibold text-foreground">Subscription Builder</h1>
                        </div>
                        <ThemeToggle />
                    </div>
                </header>

                {/* Main Content */}
                <main className="flex-1 overflow-auto">
                    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
                        {loading ? (
                            <div className="flex flex-col items-center justify-center gap-4 py-12">
                                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                                <p className="text-sm text-muted-foreground">Loading configuration...</p>
                            </div>
                        ) : error ? (
                            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
                                <p className="text-sm text-destructive">
                                    Error: {error}
                                </p>
                                <p className="text-xs text-muted-foreground mt-2">
                                    Make sure the server is running at {window.location.origin}
                                </p>
                            </div>
                        ) : (
                            <SubscriptionPanel config={null} />
                        )}
                    </div>
                </main>
            </div>
        </TooltipProvider>
    );
}
