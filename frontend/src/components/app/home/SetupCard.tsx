"use client";

import Link from "next/link";
import { setupSteps } from "@/lib/team";
import { canAdmin } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";

/** Two steps before Nova can help; hidden once both are done. */
export function SetupCard({ onChooseModel }: { onChooseModel: () => void }) {
  const { snapshot } = useWorkspace();
  const steps = setupSteps(snapshot.agents, snapshot.connections);
  if (steps.done) return null;
  const head = snapshot.agents.find((a) => a.isHead);
  const name = head?.name ?? "Nova";
  const admin = canAdmin(snapshot.role);
  const row = "flex items-center gap-2 rounded-[10px] bg-bg px-3 py-2 text-sm";
  return (
    <section aria-label="Finish setting up" className="mb-3 rounded-[14px] border border-line bg-paper p-4">
      <p className="font-semibold">Two quick steps before {name} can help</p>
      {!admin ? (
        <p className="mt-2 text-sm text-muted">Ask the company owner to finish setup.</p>
      ) : (
        <ol className="mt-3 space-y-2">
          <li className={row}>
            {steps.service ? <span>✓ Connect an AI service</span> : <><span className="flex-1">1. Your team needs an AI service to think with.</span><Link href={`/w/${snapshot.workspace.slug}/settings?tab=ai`} className="btn-dark rounded-[8px] px-3 py-1.5 text-xs font-semibold">Connect an AI service</Link></>}
          </li>
          <li className={row}>
            {steps.model ? <span>✓ Choose {name}&apos;s AI model</span> : <><span className="flex-1">2. Pick which AI model {name} uses.</span><button disabled={!steps.service || !head} onClick={onChooseModel} className="btn-dark rounded-[8px] px-3 py-1.5 text-xs font-semibold disabled:opacity-50">Choose {name}&apos;s AI model</button></>}
          </li>
        </ol>
      )}
    </section>
  );
}
