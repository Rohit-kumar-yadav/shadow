import dns from "node:dns/promises";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import * as cheerio from "cheerio";
export function publicAddress(address: string) {
  if (net.isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (net.isIP(address) === 6) {
    const a = address.toLowerCase(),
      first = parseInt(a.split(":")[0], 16);
    return (
      (first & 0xe000) === 0x2000 &&
      !a.startsWith("2001:db8") &&
      !a.startsWith("2001:0:") &&
      !a.startsWith("2002:")
    );
  }
  return false;
}
export async function validateUrl(input: string) {
  const url = new URL(input);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !["80", "443"].includes(url.port))
  )
    throw new Error(
      "Only public HTTP/HTTPS URLs on standard ports are allowed.",
    );
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host)
    ? [{ address: host, family: net.isIP(host) }]
    : await dns.lookup(host, { all: true });
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw new Error(
      "Private, local, and reserved network addresses are blocked.",
    );
  return { url, address: addresses[0] };
}
export async function fetchPublic(
  input: string,
  signal?: AbortSignal,
  maxBytes = 5_000_000,
  redirects = 0,
): Promise<{ url: string; body: Buffer; contentType: string }> {
  if (redirects > 5) throw new Error("Too many redirects.");
  const { url, address } = await validateUrl(input);
  const response = await new Promise<{
    status: number;
    headers: http.IncomingHttpHeaders;
    body: Buffer;
  }>((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const request = client.get(
      url,
      {
        signal,
        timeout: 20000,
        headers: {
          "User-Agent": "ShadowAssistant/0.1 (personal research)",
          Accept: "text/html,application/json,image/*,*/*;q=0.8",
          "Accept-Encoding": "identity",
        },
        lookup: ((_host: string, opts: { all?: boolean }, cb: Function) =>
          opts.all
            ? cb(null, [{ address: address.address, family: address.family }])
            : cb(null, address.address, address.family)) as never,
      },
      (res) => {
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            res.destroy(new Error("Download exceeds the size limit."));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
        res.on("error", reject);
      },
    );
    request.on("timeout", () =>
      request.destroy(new Error("Website timed out.")),
    );
    request.on("error", reject);
  });
  if (
    response.status >= 300 &&
    response.status < 400 &&
    response.headers.location
  )
    return fetchPublic(
      new URL(response.headers.location, url).href,
      signal,
      maxBytes,
      redirects + 1,
    );
  if (response.status < 200 || response.status >= 300)
    throw new Error(`Website returned HTTP ${response.status}.`);
  return {
    url: url.href,
    body: response.body,
    contentType: String(
      response.headers["content-type"] || "application/octet-stream",
    ),
  };
}
export function pageText(html: string) {
  const $ = cheerio.load(html);
  $("script,style,nav,footer,svg,noscript").remove();
  return {
    title: $("title").text().trim(),
    text: $("body").text().replace(/\s+/g, " ").trim().slice(0, 22000),
  };
}
export async function searchWeb(query: string, signal?: AbortSignal) {
  const result = await fetchPublic(
    "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query),
    signal,
  );
  const $ = cheerio.load(result.body.toString("utf8"));
  const results: { title: string; url: string; snippet: string }[] = [];
  $(".result").each((_, el) => {
    const a = $(el).find(".result__a");
    let href = a.attr("href") || "";
    try {
      const u = new URL(href, "https://duckduckgo.com");
      href = u.searchParams.get("uddg") || u.href;
      if (/^https?:/.test(href))
        results.push({
          title: a.text(),
          url: href,
          snippet: $(el).find(".result__snippet").text(),
        });
    } catch {}
  });
  return {
    query,
    results: results.slice(0, 8),
    note: results.length
      ? undefined
      : "Search returned no results or a verification challenge. Try browser search or supplied source URLs.",
  };
}
