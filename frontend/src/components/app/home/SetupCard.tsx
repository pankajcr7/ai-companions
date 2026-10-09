"use client";

import Link from "next/link";
import { ArrowRight, Plug } from "@phosphor-icons/react";
import { setupSteps } from "@/lib/team";
import { canAdmin } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";

/** Show only the next action required to start chatting. */
export function SetupCard({ onChooseModel }: { onChooseModel: () => void }) {
  const { snapshot } = useWorkspace();
  const steps = setupSteps(snapshot.agents, snapshot.connections);
  if (steps.done) return null;
  const head = snapshot.agents.find((a) => a.isHead);
  const name = head?.name ?? "Nova";
  const admin = canAdmin(snapshot.role);
  return (
    <section aria-label="Finish setting up" className="chat-setup">
      <span className="chat-setup-icon"><Plug size={21} /></span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{!steps.service ? `Let’s get ${name} ready` : `One more step to meet ${name}`}</p>
        <p className="mt-1 text-sm text-muted">{!admin ? "Ask your workspace owner to finish connecting your AI service." : !steps.service ? "Connect an AI service to start your first conversation." : `Choose the AI model ${name} will use to help you.`}</p>
      </div>
      {admin && (!steps.service ? <Link href={`/w/${snapshot.workspace.slug}/settings?tab=ai`} className="chat-setup-action">Connect an AI service<ArrowRight size={16} /></Link> : <button disabled={!head} onClick={onChooseModel} className="chat-setup-action">Choose {name}’s AI model<ArrowRight size={16} /></button>)}
    </section>
  );
}
