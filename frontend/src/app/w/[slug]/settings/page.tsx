"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AIServices } from "@/components/app/settings/AIServices";
import { CompanySettings } from "@/components/app/settings/CompanySettings";

const TABS = [
  { id: "company", label: "Company" },
  { id: "ai", label: "AI services" },
] as const;

function SettingsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = params.get("tab") === "ai" ? "ai" : "company";
  return (
    <main className="max-w-3xl space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <div role="tablist" aria-label="Settings sections" className="flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => router.replace(`${pathname}?tab=${t.id}`)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${tab === t.id ? "border-ink" : "border-transparent text-muted"}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">{tab === "ai" ? <AIServices /> : <CompanySettings />}</div>
    </main>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-muted">Loading settings...</div>}>
      <SettingsInner />
    </Suspense>
  );
}
