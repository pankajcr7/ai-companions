"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { api, ApiError } from "@/lib/api";
import type { Me } from "@/lib/types";

/** Sends a signed-in user to their first workspace, or to onboarding, or to sign-in. */
export default function AppEntry() {
  const router = useRouter();
  useEffect(() => {
    api<Me>("/api/me").then(
      (me) => router.replace(me.workspaces[0] ? `/w/${me.workspaces[0].slug}` : "/onboarding"),
      (e) => router.replace(e instanceof ApiError && e.status === 401 ? "/sign-in" : "/sign-in?error=1"),
    );
  }, [router]);
  return <p className="p-8 text-muted">Opening your office...</p>;
}
