"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { setWorkflowMode } from "@/app/actions/user";
import { WORKFLOW_OPTIONS, type WorkflowMode } from "@/lib/workflow";
import { cn } from "@/lib/utils";

/** Settings → Workflow: daily tracking or statement uploads. Only changes what comes first. */
export function WorkflowPanel({ initial }: { initial: { mode: WorkflowMode; chosen: boolean } | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<WorkflowMode>(initial?.mode ?? "statements");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = async (value: WorkflowMode) => {
    if (saving) return;
    const previous = mode;
    setMode(value);
    setSaving(true);
    setError(null);
    try {
      await setWorkflowMode(value);
      try {
        window.localStorage.setItem("fortuna:workflowMode", value);
      } catch {}
      router.refresh();
    } catch (err) {
      setMode(previous);
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3 min-w-0">
          <CalendarClock className="h-6 w-6 shrink-0 text-primary" />
          <div className="min-w-0">
            <CardTitle>Workflow</CardTitle>
            <p className="text-sm text-dark-5 dark:text-dark-6 mt-1">
              Changes what the dashboard and menu show first. Every screen stays available.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-2" role="radiogroup" aria-label="Workflow">
        {WORKFLOW_OPTIONS.map((option) => {
          const selected = option.value === mode;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={saving}
              onClick={() => void choose(option.value)}
              className={cn(
                "flex items-start gap-3 rounded-lg border p-4 text-left transition",
                selected
                  ? "border-primary bg-primary/5"
                  : "border-stroke hover:border-primary dark:border-dark-3",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                  selected ? "border-primary" : "border-dark-5",
                )}
              >
                {selected ? <span className="size-2 rounded-full bg-primary" /> : null}
              </span>
              <span>
                <span className="block font-semibold text-dark dark:text-white">{option.label}</span>
                <span className="mt-1 block text-sm text-dark-5 dark:text-dark-6">{option.description}</span>
              </span>
            </button>
          );
        })}
        {error ? <p className="text-sm text-red md:col-span-2">{error}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}
