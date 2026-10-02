"use client";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { stepLabel } from "@/lib/chat/client";

type Step = { name: string; done?: boolean; ok?: boolean };

/** The assistant's tool steps as a compact timeline, collapsed once finished (like an agent's tool log). */
export function ActivitySteps({
  steps,
  live = false,
}: {
  steps: Step[];
  live?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!steps.length) return null;
  const expanded = live || open;
  const failed = steps.filter((s) => s.ok === false).length;
  return (
    <div className="text-sm text-dark-5 dark:text-dark-6">
      {!live && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="inline-flex items-center gap-1 rounded py-0.5 hover:text-dark dark:hover:text-white"
        >
          <ChevronRight
            size={14}
            aria-hidden
            className={`transition-transform ${open ? "rotate-90" : ""}`}
          />
          {steps.length} {steps.length === 1 ? "step" : "steps"}
          {failed > 0 && <span className="text-red"> · {failed} failed</span>}
        </button>
      )}
      {expanded && (
        <ol
          aria-label="Assistant steps"
          className="mt-1 space-y-1 border-l border-stroke pl-3 dark:border-stroke-dark"
        >
          {steps.map((step, i) => {
            const running = live && !step.done;
            return (
              <li key={i} className="relative flex items-center gap-2">
                <span
                  aria-hidden
                  className={`absolute -left-[17px] h-2 w-2 rounded-full ${
                    running
                      ? "animate-pulse bg-primary"
                      : step.ok === false
                        ? "bg-red"
                        : "bg-green"
                  }`}
                />
                <span className={running ? "text-dark dark:text-white" : ""}>
                  {stepLabel(step.name)}
                  {running && "…"}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
