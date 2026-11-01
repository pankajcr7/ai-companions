// The desktop app (desktop/) gives its window `window.agentDesktop`; in a normal browser it's absent.

export type AgentDesktop = {
  version: string;
  /** This app install: a folder project's files are reached through it. */
  deviceId: string;
  pickFolder(): Promise<string | null>;
  attach(projectId: string, folder: string): Promise<void>;
  folderOf(projectId: string): Promise<string | null>;
  projectOf(folder: string): Promise<string | null>;
  showFolder(projectId: string): Promise<void>;
  forget(projectId: string): Promise<void>;
};

export const desktopBridge = (): AgentDesktop | null => (typeof window === "undefined" ? null : ((window as { agentDesktop?: AgentDesktop }).agentDesktop ?? null));

/** For useSyncExternalStore: whether the page runs in the desktop app never changes. */
export const noSubscribe = () => () => {};

/** The project name for a folder: its own name, cut to fit. */
export const folderName = (path: string) => (path.split(/[\\/]/).filter(Boolean).pop() ?? "").slice(0, 56) || "Folder";
