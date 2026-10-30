import { randomUUID } from "node:crypto";
import { HttpError } from "../http.js";

// The relay to the desktop app that holds a project's folder: the app long-polls for requests and answers each one.
// ponytail: in-memory, so one server instance; move the queues to Postgres LISTEN/NOTIFY or Redis to run several.

type Call = { id: string; projectId: string; op: string; args: object };
type Device = { userId: string; lastSeen: number; queue: Call[]; wake?: () => void };
const devices = new Map<string, Device>();
const pending = new Map<string, { device: string; resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();

/** A device that hasn't asked for work in this long is treated as closed. */
const ONLINE_MS = 40_000;
export const OFFLINE_MESSAGE = "Open the Agent Company app on the computer that has this folder.";
const STATUS: Record<string, number> = { conflict: 409, not_found: 404, invalid: 400, too_large: 413 };

/** Runs one file operation on the project's folder, through the app that holds it. */
export async function desktopCall(project: { id: string; deviceId: string | null; createdById: string }, op: string, args: object, timeoutMs = 30_000): Promise<unknown> {
  const d = project.deviceId ? devices.get(project.deviceId) : undefined;
  if (!d || d.userId !== project.createdById || Date.now() - d.lastSeen > ONLINE_MS) throw new HttpError(409, "desktop_offline", OFFLINE_MESSAGE);
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      d.queue = d.queue.filter((c) => c.id !== id);
      reject(new HttpError(504, "desktop_timeout", "The app on your computer didn't answer in time. Check that it's open and online."));
    }, timeoutMs);
    pending.set(id, { device: project.deviceId!, resolve, reject, timer });
    d.queue.push({ id, projectId: project.id, op, args });
    d.wake?.();
  });
}

/** The app asking for work: returns queued calls at once, or waits up to waitMs for one. */
export async function poll(deviceId: string, userId: string, waitMs: number): Promise<Call[]> {
  let d = devices.get(deviceId);
  if (d && d.userId !== userId) throw new HttpError(403, "forbidden", "This app install is signed in as someone else.");
  if (!d) devices.set(deviceId, (d = { userId, lastSeen: 0, queue: [] }));
  const device = d;
  device.lastSeen = Date.now();
  if (!device.queue.length && waitMs > 0) {
    device.wake?.();
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        if (device.wake === done) device.wake = undefined;
        resolve();
      };
      const timer = setTimeout(done, waitMs);
      device.wake = done;
    });
  }
  device.lastSeen = Date.now();
  return device.queue.splice(0);
}

/** The app's answer to one call. Answers to calls that gave up, or from another device, are ignored. */
export function answer(deviceId: string, userId: string, id: string, ok: boolean, result: unknown, error?: { code?: string; message: string }) {
  const p = pending.get(id);
  if (!p || p.device !== deviceId || devices.get(deviceId)?.userId !== userId) return;
  clearTimeout(p.timer);
  pending.delete(id);
  if (ok) p.resolve(result);
  else p.reject(new HttpError(STATUS[error?.code ?? ""] ?? 502, error?.code ?? "desktop_error", error?.message ?? "The app on your computer couldn't do that."));
}
