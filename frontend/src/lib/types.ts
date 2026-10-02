export type Role = "owner" | "admin" | "member" | "viewer";
export type Appearance = {
  style: "robot" | "orb";
  color: string;
  head: "square" | "round" | "tall";
  eyes: "dots" | "visor" | "wide";
  accessory: "none" | "antenna" | "headset" | "cap";
};
export type Agent = {
  id: string;
  name: string;
  role: string;
  kind: "ai" | "human";
  workingStyle: string;
  status: "active" | "paused" | "archived";
  isHead: boolean;
  departmentId: string | null;
  managerId: string | null;
  appearance: Appearance;
};
export type Department = { id: string; name: string; sortOrder: number };
export type Zone = { departmentId: string; x: number; y: number; w: number; h: number };
export type Layout = { zones: Zone[]; desks: Record<string, { x: number; y: number }> };
export type Preferences = { theme: "system" | "light" | "dark"; reducedMotion: boolean; calmMode: boolean };
export type Snapshot = {
  workspace: { id: string; name: string; slug: string };
  role: Role;
  departments: Department[];
  agents: Agent[];
  layout: Layout;
  preferences: Preferences;
};
export type Me = { user: { id: string; name: string; email: string }; workspaces: { id: string; name: string; slug: string; role: Role }[] };

export const UNASSIGNED = "unassigned";
export const canEdit = (r: Role) => r !== "viewer";
export const canAdmin = (r: Role) => r === "owner" || r === "admin";
export const statusLabel = (a: Agent) => ({ active: "Idle", paused: "Paused", archived: "Archived" })[a.status];
