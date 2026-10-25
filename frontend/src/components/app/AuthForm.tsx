"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { GoogleLogo } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { NetworkField } from "@/components/landing/NetworkField";
import { RobotModel } from "@/components/landing/RobotModel";
import { Corners, Glow, Label, Logo } from "@/components/landing/ui";

const input =
  "mt-2 w-full rounded-[12px] border border-cream/15 bg-cream/[0.04] px-4 py-3 text-cream placeholder:text-cream/40 transition-colors focus:border-lime focus:outline-none";

/** Sign in and sign up, in the landing page's dusk look: the scene on the left, the form on the right. */
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
    <main className="on-dark grid min-h-[100dvh] bg-night text-cream lg:grid-cols-[1.1fr_0.9fr]">
      <aside className="dusk relative isolate hidden flex-col justify-between overflow-hidden border-r border-cream/10 p-12 lg:flex">
        <div className="absolute inset-0 -z-10">
          <NetworkField />
        </div>
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-2/3 bg-gradient-to-t from-night via-night/50 to-transparent" />
        <Link href="/" aria-label="Agent Company home" className="relative w-fit">
          <Logo className="!text-cream" />
        </Link>
        <div className="relative mx-auto aspect-[4/5] w-full max-w-[360px]">
          <div aria-hidden="true" className="absolute inset-x-[20%] bottom-[6%] h-1/4 rounded-full bg-lime/20 blur-3xl" />
          <RobotModel className="absolute inset-0" />
        </div>
        <div className="relative">
          <p className="font-display text-[clamp(44px,4.8vw,80px)] font-medium leading-[0.92] tracking-[-0.05em]">
            Hire an
            <br />
            <span className="font-serif text-[1.12em] font-normal italic tracking-[-0.02em]">
              <span className="bg-gradient-to-r from-[#7fd8ca] via-[#b8e05a] to-lime bg-clip-text pb-[0.08em] pr-[0.15em] text-transparent">AI team</span>
            </span>
          </p>
          <p className="mt-5 max-w-[40ch] text-cream/80">Give one goal. Your AI companions plan it, debate it, review it, and deliver real work you can see.</p>
        </div>
      </aside>

      <div className="relative isolate flex items-center justify-center overflow-hidden px-4 py-12">
        <Glow className="-right-60 -top-60" />
        <Glow className="-bottom-72 -left-60 bg-teal/10" />
        <div className="w-full max-w-md">
          <Link href="/" aria-label="Agent Company home" className="mb-10 block w-fit lg:hidden">
            <Logo className="!text-cream" />
          </Link>
          <div className="relative rounded-[24px] border border-cream/10 bg-cream/[0.03] p-7 backdrop-blur-sm sm:p-9">
            <Label>{mode === "sign-up" ? "New account" : "Sign in"}</Label>
            <h1 className="mt-5 font-display text-3xl font-medium tracking-[-0.03em] sm:text-4xl">{title}</h1>
            <form onSubmit={submit} className="mt-8 space-y-5">
              {mode === "sign-up" && (
                <label className="block text-sm font-medium text-cream/85">
                  Name
                  <input name="name" required maxLength={60} autoComplete="name" placeholder="Your name" className={input} />
                </label>
              )}
              <label className="block text-sm font-medium text-cream/85">
                Email
                <input name="email" type="email" required autoComplete="email" placeholder="you@company.com" className={input} />
              </label>
              <label className="block text-sm font-medium text-cream/85">
                Password
                <input
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
                  placeholder={mode === "sign-up" ? "At least 8 characters" : ""}
                  className={input}
                />
              </label>
              {error && (
                <p role="alert" className="text-sm text-[#ffb4a6]">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-[12px] bg-lime py-3.5 text-sm font-semibold text-night transition-transform hover:-translate-y-px active:translate-y-px disabled:opacity-70"
              >
                {busy ? "One moment..." : mode === "sign-up" ? "Create account" : "Sign in"}
              </button>
            </form>

            <div className="my-6 flex items-center gap-4 text-xs uppercase tracking-[0.16em] text-haze">
              <span className="h-px flex-1 bg-cream/10" />
              or
              <span className="h-px flex-1 bg-cream/10" />
            </div>
            <button
              type="button"
              disabled={!google}
              onClick={() => authClient.signIn.social({ provider: "google", callbackURL: "/app" })}
              className="flex w-full items-center justify-center gap-2 rounded-[12px] border border-cream/20 py-3 text-sm font-semibold text-cream transition-colors hover:bg-cream/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <GoogleLogo size={18} weight="bold" /> Continue with Google
            </button>
            {google === false && <p className="mt-2 text-xs text-haze">Google sign-in isn&apos;t set up on this server yet.</p>}

            <p className="mt-8 text-sm text-haze">
              {mode === "sign-up" ? "Already have an account? " : "New here? "}
              <Link href={mode === "sign-up" ? "/sign-in" : "/sign-up"} className="font-medium text-cream underline decoration-lime underline-offset-4">
                {mode === "sign-up" ? "Sign in" : "Create an account"}
              </Link>
            </p>
            <Corners />
          </div>
        </div>
      </div>
    </main>
  );
}
