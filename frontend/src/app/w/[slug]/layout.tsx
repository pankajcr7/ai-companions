"use client";

import { useParams } from "next/navigation";
import { AppShell } from "@/components/app/AppShell";
import { WorkspaceProvider } from "@/lib/workspace";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { slug } = useParams<{ slug: string }>();
  return (
    <WorkspaceProvider slug={slug}>
      <AppShell>{children}</AppShell>
    </WorkspaceProvider>
  );
}
