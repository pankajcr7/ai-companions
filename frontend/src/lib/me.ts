import { api } from "./api";
import type { Me } from "./types";

// Who is signed in, kept for a short while so opening the app doesn't ask the server twice.
let cached: { at: number; me: Promise<Me> } | null = null;
const FRESH_MS = 30_000;

export function loadMe(fresh = false): Promise<Me> {
  if (fresh || !cached || Date.now() - cached.at > FRESH_MS) {
    const me = api<Me>("/api/me");
    cached = { at: Date.now(), me };
    // A failed answer isn't kept.
    me.catch(() => {
      if (cached?.me === me) cached = null;
    });
  }
  return cached.me;
}

/** After signing out, or creating or joining a workspace. */
export function forgetMe() {
  cached = null;
}

/** Where a signed-in person starts: their first workspace, or onboarding to create one. */
export const homeOf = (me: Me) => (me.workspaces[0] ? `/w/${me.workspaces[0].slug}` : "/onboarding");
