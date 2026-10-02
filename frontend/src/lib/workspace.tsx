"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, ApiError } from "./api";
import type { Me, Snapshot } from "./types";

type Ctx = {
  snapshot: Snapshot;
  reload: () => Promise<void>;
  setSnapshot: (s: Snapshot) => void;
  /** Builds `/api/workspaces/:id<path>` for the current workspace. */
  wsPath: (path?: string) => string;
};

const WorkspaceContext = createContext<Ctx | null>(null);

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return ctx;
}

export function WorkspaceProvider({ slug, children }: { slug: string; children: React.ReactNode }) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");

  // Fetch returns what to do; state is applied in the promise callback (no setState inside the effect body).
  const fetchState = useCallback(async (): Promise<{ snapshot?: Snapshot; error?: string; redirect?: string }> => {
    try {
      const me = await api<Me>("/api/me");
      const ws = me.workspaces.find((w) => w.slug === slug);
      if (!ws) return { redirect: me.workspaces[0] ? `/w/${me.workspaces[0].slug}` : "/onboarding" };
      return { snapshot: await api<Snapshot>(`/api/workspaces/${ws.id}`) };
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return { redirect: "/sign-in" };
      return { error: (e as Error).message };
    }
  }, [slug]);

  const apply = useCallback(
    (r: { snapshot?: Snapshot; error?: string; redirect?: string }) => {
      if (r.redirect) return router.replace(r.redirect);
      if (r.snapshot) setSnapshot(r.snapshot);
      setError(r.error ?? "");
    },
    [router],
  );

  const load = useCallback(() => fetchState().then(apply), [fetchState, apply]);

  useEffect(() => {
    fetchState().then(apply);
  }, [fetchState, apply]);

  if (error) {
    return (
      <div className="grid min-h-[100dvh] place-items-center p-8 text-center">
        <div>
          <p role="alert">{error}</p>
          <button onClick={load} className="btn-light mt-4 rounded-[10px] px-4 py-2 text-sm font-semibold">Try again</button>
        </div>
      </div>
    );
  }
  if (!snapshot) return <div className="min-h-[100dvh] animate-pulse bg-bg" aria-busy="true" aria-label="Loading your office" />;

  const wsPath = (path = "") => `/api/workspaces/${snapshot.workspace.id}${path}`;
  return <WorkspaceContext value={{ snapshot, reload: load, setSnapshot, wsPath }}>{children}</WorkspaceContext>;
}
