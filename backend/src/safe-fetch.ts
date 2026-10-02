import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { BlockList, isIP } from "node:net";
import { Agent, fetch, type Response } from "undici";

export class UnsafeUrlError extends Error {}

export const allowLocal = () => process.env.ALLOW_LOCAL_ENDPOINTS === "true";

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) blocked.addSubnet(net, prefix, "ipv6");

export function isPublicAddress(address: string): boolean {
  // IPv4-mapped IPv6 (dotted or hex form) is judged as the IPv4 address it carries.
  // (No ::ffff:0:0/96 rule: BlockList also matches plain IPv4 against it, which would block everything.)
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return isPublicAddress(mapped[1]);
  const hex = address.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (hex) {
    const [hi, lo] = [parseInt(hex[1], 16), parseInt(hex[2], 16)];
    return isPublicAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  const family = isIP(address);
  if (!family) return false;
  return !blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}

const PRIVATE_NAME = /^(localhost|.+\.localhost|.+\.local|.+\.internal)$/i;

/** Validates a user-supplied base URL and returns it without a trailing slash. */
export function checkBaseUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new UnsafeUrlError("That isn't a valid URL");
  }
  if (u.username || u.password) throw new UnsafeUrlError("Remove the username and password from the URL");
  const local = allowLocal();
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) throw new UnsafeUrlError("Use an https:// URL");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!local && ((isIP(host) && !isPublicAddress(host)) || PRIVATE_NAME.test(host))) {
    throw new UnsafeUrlError("That address is on a private network. Set ALLOW_LOCAL_ENDPOINTS=true on a self-hosted install to use it.");
  }
  u.hash = "";
  u.search = "";
  return u.toString().replace(/\/+$/, "");
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** DNS lookup used at connect time, so a hostname can't be re-pointed at a private address after validation. */
export function guardedLookup(hostname: string, options: { all?: boolean; family?: number }, callback: LookupCallback) {
  dnsLookup(hostname, { family: options.family ?? 0, all: true }, (err, addresses) => {
    if (err) return callback(err, []);
    const list = addresses as LookupAddress[];
    if (!list.length || list.some((a) => !isPublicAddress(a.address))) {
      return callback(new UnsafeUrlError("That address is on a private network"), []);
    }
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

const timeouts = { headersTimeout: 60_000, bodyTimeout: 60_000, connectTimeout: 10_000 };
const publicAgent = new Agent({ ...timeouts, connect: { lookup: guardedLookup as never } });
const localAgent = new Agent(timeouts);

export type SafeInit = { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal };

export function safeFetch(url: string, init: SafeInit = {}): Promise<Response> {
  checkBaseUrl(url);
  return fetch(url, { ...init, redirect: "error", dispatcher: allowLocal() ? localAgent : publicAgent });
}
