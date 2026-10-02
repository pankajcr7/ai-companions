"use client";

import { useState } from "react";

type State = { kind: "idle" | "sending" | "done" } | { kind: "error"; message: string };

const field =
  "mt-2 w-full border-b border-paper/25 bg-transparent pb-3 text-base text-paper placeholder:text-paper/55 focus:border-lime focus:outline-none";

export function EarlyAccessForm() {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.status === 429) throw new Error("Too many tries. Wait a minute and try again.");
      if (!res.ok) throw new Error(res.status === 400 ? "Check your email address and try again." : "Something went wrong. Try again.");
      setState({ kind: "done" });
    } catch (err) {
      setState({ kind: "error", message: err instanceof TypeError ? "Can't reach the server right now. Try again in a moment." : (err as Error).message });
    }
  }

  if (state.kind === "done") {
    return (
      <div role="status" className="rounded-[12px] border border-lime/40 bg-lime/10 p-6">
        <p className="text-lg font-semibold">You&apos;re on the list.</p>
        <p className="mt-2 text-sm text-paper/75">We&apos;ll email you when your team is ready to hire.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-8">
      <div>
        <label htmlFor="name" className="text-xs font-medium uppercase tracking-wide text-paper/80">
          /Your name
        </label>
        <input id="name" name="name" autoComplete="name" maxLength={120} placeholder="Enter your full name" className={field} />
      </div>
      <div>
        <label htmlFor="email" className="text-xs font-medium uppercase tracking-wide text-paper/80">
          /Your email <span className="text-lime">*</span>
        </label>
        <input id="email" name="email" type="email" required autoComplete="email" placeholder="you@company.com" className={field} />
      </div>
      <div>
        <label htmlFor="goal" className="text-xs font-medium uppercase tracking-wide text-paper/80">
          /What would you hand over first?
        </label>
        <textarea id="goal" name="goal" rows={3} maxLength={1000} placeholder="For example: a landing page for my bakery" className={`${field} resize-none`} />
      </div>
      <div>
        <button
          type="submit"
          disabled={state.kind === "sending"}
          className="btn-dark w-full rounded-[12px] py-3.5 text-sm font-semibold text-paper transition-transform active:translate-y-px disabled:opacity-70"
        >
          {state.kind === "sending" ? "Joining..." : "Get early access"}
        </button>
        <p aria-live="polite" className={`mt-3 text-sm ${state.kind === "error" ? "text-[#ffb4a6]" : "text-paper/60"}`}>
          {state.kind === "error" ? state.message : "One email when it's ready. No spam."}
        </p>
      </div>
    </form>
  );
}
