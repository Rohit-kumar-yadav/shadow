export async function api<T = any>(
  url: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const r = await fetch("/api" + url, {
    method,
    credentials: "same-origin",
    ...(body !== undefined
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  if (!r.ok) {
    let e;
    try {
      e = await r.json();
    } catch {}
    throw new Error(e?.error || `Request failed (${r.status})`);
  }
  return r.json();
}
