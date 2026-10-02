export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const hasBody = init.body !== undefined;
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? "GET",
      headers: hasBody ? { "content-type": "application/json" } : undefined,
      body: hasBody ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error?.message ?? "Something went wrong. Try again.");
  return data as T;
}
