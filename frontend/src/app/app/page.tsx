"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ApiError } from "@/lib/api";
import { homeOf, loadMe } from "@/lib/me";

/** Sends a signed-in user to their first workspace, or to onboarding, or to sign-in. */
export default function AppEntry() {
  const router = useRouter();
  useEffect(() => {
    loadMe().then(
      (me) => router.replace(homeOf(me)),
      (e) => router.replace(e instanceof ApiError && e.status === 401 ? "/sign-in" : "/sign-in?error=1"),
    );
  }, [router]);
  return <p className="p-8 text-muted">Opening your office...</p>;
}
