import { type Remote, RemoteError, type RemoteErrorKind, type RemoteFile } from "./types";

const kindOf = (status: number): RemoteErrorKind =>
  status === 401 ? "signed-out"
  : status === 403 ? "read-only"
  : status === 409 ? "conflict"
  : status === 413 ? "too-big"
  : status === 400 || status === 415 ? "rejected"
  : status === 429 || status >= 500 ? "busy"
  : "failed";

/** A project on the live site, used with the app window's sign-in. */
export class ProjectApi implements Remote {
  constructor(private o: { baseUrl: string; workspaceId: string; projectId: string; cookie: () => Promise<string> }) {}

  private async call(method: string, sub: string, body?: Buffer, okStatuses: number[] = []): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.o.baseUrl}/api/workspaces/${this.o.workspaceId}/projects/${this.o.projectId}${sub}`, {
        method,
        body: body && new Uint8Array(body),
        headers: { cookie: await this.o.cookie(), origin: this.o.baseUrl, ...(body ? { "content-type": "application/octet-stream" } : {}) },
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      throw new RemoteError("offline", "Can't reach Agent Company");
    }
    if (res.ok || okStatuses.includes(res.status)) return res;
    const message = ((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message;
    throw new RemoteError(kindOf(res.status), message ?? `The server answered ${res.status}`);
  }

  async list(): Promise<RemoteFile[]> {
    const { entries } = (await (await this.call("GET", "/tree")).json()) as { entries: { path: string; kind: string; revision: number; hash: string | null; size: number }[] };
    return entries.filter((e) => e.kind === "file" && e.hash).map((e) => ({ path: e.path, rev: e.revision, hash: e.hash!, size: e.size }));
  }

  async read(path: string) {
    return Buffer.from(await (await this.call("GET", `/download?path=${encodeURIComponent(path)}`)).arrayBuffer());
  }

  async save(path: string, data: Buffer, baseRev: number) {
    const res = await this.call("PUT", `/files/raw?path=${encodeURIComponent(path)}&baseRevision=${baseRev}`, data);
    return ((await res.json()) as { revision: number }).revision;
  }

  async remove(path: string) {
    await this.call("DELETE", `/entries?path=${encodeURIComponent(path)}`, undefined, [404]);
  }
}
