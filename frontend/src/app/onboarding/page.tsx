"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Logo } from "@/components/landing/ui";

const templates = [
  { key: "starter", title: "Starter", text: "5 companions: head agent, product, engineering, design, content." },
  { key: "studio", title: "Full studio", text: "13 companions across six departments, with managers." },
  { key: "head-only", title: "Just the head agent", text: "Start with one and hire as you go." },
] as const;

export default function Onboarding() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api("/api/me").catch((e) => e instanceof ApiError && e.status === 401 && router.replace("/sign-in"));
  }, [router]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const ws = await api<{ slug: string }>("/api/workspaces", { method: "POST", body: { name: f.get("name"), template: f.get("template") } });
      router.push(`/w/${ws.slug}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="app grid-paper grid min-h-[100dvh] place-items-center px-4 py-12" data-theme="light">
      <form onSubmit={submit} className="w-full max-w-xl rounded-[16px] border border-line bg-paper p-8 shadow-sm">
        <Logo />
        <h1 className="mt-8 text-3xl font-semibold tracking-tight">Set up your company</h1>
        <label className="mt-6 block text-sm font-medium">
          Company name
          <input name="name" required maxLength={60} className="mt-2 w-full rounded-[10px] border border-line bg-paper px-4 py-3 focus:border-ink focus:outline-none" />
        </label>
        <fieldset className="mt-6">
          <legend className="text-sm font-medium">Starting team</legend>
          <div className="mt-2 grid gap-3">
            {templates.map((t, i) => (
              <label key={t.key} className="flex cursor-pointer gap-3 rounded-[12px] border border-line p-4 has-[:checked]:border-ink has-[:checked]:bg-bg">
                <input type="radio" name="template" value={t.key} defaultChecked={i === 0} className="mt-1 accent-[var(--ink)]" />
                <span>
                  <span className="block font-semibold">{t.title}</span>
                  <span className="block text-sm text-muted">{t.text}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {error && <p role="alert" className="mt-4 text-sm text-[#b42318]">{error}</p>}
        <button type="submit" disabled={busy} className="btn-dark mt-6 w-full rounded-[12px] py-3 text-sm font-semibold text-paper disabled:opacity-70">
          {busy ? "Hiring your team..." : "Create company"}
        </button>
      </form>
    </main>
  );
}
