"use client";

import { useParams } from "next/navigation";
import { CompanionPage } from "@/components/app/team/CompanionPage";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <CompanionPage key={id} agentId={id} />;
}
