export const APP_PREFIX = "Design a mobile app: ";
export const CHANGES_PREFIX = "Mobile app design changes: ";

/** The app's name: the request without "Design a mobile app: ", at most 60 characters. */
export function appName(text: string): string {
  const name = text.startsWith(APP_PREFIX) ? text.slice(APP_PREFIX.length) : text;
  return name.length > 60 ? `${name.slice(0, 57)}...` : name;
}

const STATUS: Record<string, string> = { planning: "Planning", awaiting_approval: "Ready to start", running: "Working", reviewing: "Working", done: "Done", failed: "Needs a fix", cancelled: "Stopped" };
export const appStatus = (status: string) => STATUS[status] ?? status;
export const isActive = (status: string) => ["planning", "awaiting_approval", "running", "reviewing"].includes(status);
