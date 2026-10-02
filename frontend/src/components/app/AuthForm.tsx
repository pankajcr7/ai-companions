"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { GoogleLogo } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { Logo } from "@/components/landing/ui";

const input = "mt-2 w-full rounded-[10px] border border-line bg-paper px-4 py-3 text-ink focus:border-ink focus:outline-none";

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [google, setGoogle] = useState<boolean | null>(null);

  useEffect(() => {
    authClient.getSession().then(({ data }) => data && router.replace("/app"));
    api<{ google: boolean }>("/api/auth-config").then((c) => setGoogle(c.google), () => setGoogle(false));
  }, [router]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const { error } =
      mode === "sign-up"
        ? await authClient.signUp.email({ name: f.name, email: f.email, password: f.password })
        : await authClient.signIn.email({ email: f.email, password: f.password });
    setBusy(false);
    if (error) return setError(error.message ?? "That didn't work. Check your details and try again.");
    router.push("/app");
  }

  const title = mode === "sign-up" ? "Create your account" : "Welcome back";
  return (
    <main className="app grid-paper grid min-h-[100dvh] place-items-center px-4 py-12" data-theme="light">
      <div className="w-full max-w-md rounded-[16px] border border-line bg-paper p-8 shadow-sm">
        <Link href="/" aria-label="Agent Company home"><Logo /></Link>
        <h1 className="mt-8 text-3xl font-semibold tracking-tight">{title}</h1>
        <form onSubmit={submit} className="mt-6 space-y-4">
          {mode === "sign-up" && (
            <label className="block text-sm font-medium">
              Name
              <input name="name" required maxLength={60} autoComplete="name" className={input} />
            </label>
          )}
          <label className="block text-sm font-medium">
            Email
            <input name="email" type="email" required autoComplete="email" className={input} />
          </label>
          <label className="block text-sm font-medium">
            Password
            <input name="password" type="password" required minLength={8} autoComplete={mode === "sign-up" ? "new-password" : "current-password"} className={input} />
          </label>
          {error && <p role="alert" className="text-sm text-[#b42318]">{error}</p>}
          <button type="submit" disabled={busy} className="btn-dark w-full rounded-[12px] py-3 text-sm font-semibold text-paper disabled:opacity-70">
            {busy ? "One moment..." : mode === "sign-up" ? "Create account" : "Sign in"}
          </button>
        </form>
        <div className="mt-4">
          <button
            type="button"
            disabled={!google}
            onClick={() => authClient.signIn.social({ provider: "google", callbackURL: "/app" })}
            className="btn-light flex w-full items-center justify-center gap-2 rounded-[12px] py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
          >
            <GoogleLogo size={18} weight="bold" /> Continue with Google
          </button>
          {google === false && <p className="mt-2 text-xs text-muted">Google sign-in isn&apos;t set up on this server yet.</p>}
        </div>
        <p className="mt-8 text-sm text-muted">
          {mode === "sign-up" ? "Already have an account? " : "New here? "}
          <Link href={mode === "sign-up" ? "/sign-in" : "/sign-up"} className="font-medium text-ink underline">
            {mode === "sign-up" ? "Sign in" : "Create an account"}
          </Link>
        </p>
      </div>
    </main>
  );
}
