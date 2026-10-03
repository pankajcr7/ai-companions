"use client";

import { useParams, useRouter } from "next/navigation";
import { GoalPanel } from "@/components/app/goals/GoalPanel";
import { useWorkspace } from "@/lib/workspace";

export default function GoalPage() {
  const { gid } = useParams<{ gid: string }>();
  const router = useRouter();
  const { snapshot } = useWorkspace();
  const home = `/w/${snapshot.workspace.slug}`;
  return (
    <div className="mx-auto w-full max-w-3xl flex-1">
      <GoalPanel goalId={gid} onClose={() => router.push(home)} onWorking={() => {}} onOpenGoal={(id) => router.push(`${home}/goals/${id}`)} />
    </div>
  );
}
