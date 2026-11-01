"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import { desktopBridge, folderName, noSubscribe } from "@/lib/desktop";
import { useWorkspace } from "@/lib/workspace";

/** Desktop app: a folder on this computer becomes a project (the same folder again is the same project); its files stay in the folder. */
export function useOpenFolder() {
  const { snapshot } = useWorkspace();
  const router = useRouter();
  const desk = useSyncExternalStore(noSubscribe, desktopBridge, () => null);
  const list = `/api/workspaces/${snapshot.workspace.id}/projects`;
  const base = `/w/${snapshot.workspace.slug}/projects`;
  const open = useCallback(
    async (folder: string) => {
      if (!desk) return;
      const known = await desk.projectOf(folder);
      if (known && (await api<{ projects: { id: string }[] }>(list)).projects.some((p) => p.id === known)) return router.push(`${base}/${known}`);
      const { id } = await api<{ id: string }>(list, { method: "POST", body: { name: folderName(folder), deviceId: desk.deviceId } });
      await desk.attach(id, folder);
      router.push(`${base}/${id}`);
    },
    [desk, list, base, router],
  );
  return { desk, open };
}

/** File → Open Folder… in the desktop app's menu, from any page of the workspace. */
export function MenuOpenFolder() {
  const { desk, open } = useOpenFolder();
  const [error, setError] = useState("");
  useEffect(() => desk?.onOpenFolder?.((folder) => void open(folder).then(() => setError(""), (e) => setError((e as Error).message))), [desk, open]);
  return error ? <p role="alert" className="studio-error">{error}</p> : null;
}
