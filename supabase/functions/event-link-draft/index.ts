const origin = "https://joyunliu.github.io";
const cors = {
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};

const supported = new Map<string, RegExp>([
  ["www.accupass.com", /^\/event\/[\w-]+\/?$/i],
  ["accupass.com", /^\/event\/[\w-]+\/?$/i],
  ["www.opentix.life", /^\/event\/\d+\/?$/i],
  ["opentix.life", /^\/event\/\d+\/?$/i],
  ["huanminvillage.taipei", /^\/event\/\d+\/?$/i],
  ["www.tfam.museum", /^\/kid\/Event\/Event_page\.aspx$/i],
  ["kfa.kcg.gov.tw", /^\/tw\/movies-content\/[\w-]+\/?$/i],
]);

function allowedUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.length > 1000) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !supported.get(url.hostname)?.test(url.pathname)) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

async function readText(body: ReadableStream<Uint8Array> | null, limit: number) {
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let result = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return result + decoder.decode();
      bytes += value.length;
      if (bytes > limit) throw new Error("too_large");
      result += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

const str = (value: unknown, limit = 200) =>
  typeof value === "string" ? value.trim().slice(0, limit) : "";
type Entry = Record<string, unknown>;
const obj = (value: unknown): Entry =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Entry : {};

function attributes(tag: string) {
  const attrs = new Map<string, string>();
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    attrs.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4]);
  }
  return attrs;
}

function eventData(html: string) {
  const nodes: unknown[] = [];
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (attributes(script[1]).get("type")?.toLowerCase() !== "application/ld+json") continue;
    try {
      const parsed = JSON.parse(script[2]);
      nodes.push(...(Array.isArray(parsed) ? parsed.slice(0, 100) : [parsed]));
    } catch {
      // Some pages contain malformed or unrelated structured data.
    }
  }
  const events = nodes.flatMap(node => {
    const graph = obj(node)["@graph"];
    return Array.isArray(graph) ? graph.slice(0, 100) : [node];
  }).map(obj).filter(node => {
    const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
    return types.some(type => /(?:^|[a-z/])Event$/.test(str(type)));
  });
  const event = events[0] || {};
  const meta = new Map<string, string>();
  for (const match of html.matchAll(/<meta\b([^>]*)>/gi)) {
    const attrs = attributes(match[1]);
    const name = attrs.get("property") || attrs.get("name");
    const value = attrs.get("content");
    if (name && value && !meta.has(name.toLowerCase())) meta.set(name.toLowerCase(), value);
  }
  const location = obj(Array.isArray(event.location) ? event.location[0] : event.location);
  const address = obj(location.address);
  const organizers = Array.isArray(event.organizer) ? event.organizer : [event.organizer];
  const offers = (Array.isArray(event.offers) ? event.offers : [event.offers]).map(obj);
  const prices = offers.map(offer => {
    if (str(offer.priceCurrency).toUpperCase() !== "TWD") return null;
    const amount = offer.price ?? (offer.lowPrice === offer.highPrice ? offer.lowPrice : undefined);
    const value = typeof amount === "number" ? String(amount) : str(amount);
    return /^\d{1,6}(?:\.0+)?$/.test(value) && Number(value) <= 100000 ? Number(value) : null;
  });
  return {
    title: str(event.name) || str(meta.get("og:title")) || str(html.match(/<title[^>]*>([^<]*)<\/title\s*>/i)?.[1]),
    description: str(meta.get("og:description") || meta.get("description"), 240) || str(event.description, 240),
    organizer: organizers.map(value => str(obj(value).name || value, 100)).filter(Boolean).join("、").slice(0, 100),
    venue: str(location.name, 60),
    address: str(location.address, 100) || [address.addressRegion, address.addressLocality, address.streetAddress]
      .map(value => str(value, 100)).filter(Boolean).join("").slice(0, 100),
    start: str(event.startDate, 45),
    end: str(event.endDate, 45),
    sessions: events.filter(row => row.name === event.name && JSON.stringify(row.location) === JSON.stringify(event.location))
      .slice(0, 60).map(row => ({ start: str(row.startDate, 45), end: str(row.endDate, 45) })),
    age: str(event.typicalAgeRange, 40),
    online: str(event.eventAttendanceMode).endsWith("OnlineEventAttendanceMode"),
    fee: event.isAccessibleForFree === true ? 0 : prices[0] !== null && prices.every(price => price === prices[0]) ? prices[0] : null,
  };
}

const json = (body: object, status = 200) =>
  Response.json(body, { status, headers: cors });

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (request.method !== "POST" || (request.headers.get("origin") && request.headers.get("origin") !== origin)) {
    return json({ code: "unsupported" }, 403);
  }
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return json({ code: "login" }, 401);
  try {
    let url = allowedUrl(JSON.parse(await readText(request.body, 2048)).url);
    if (!url) return json({ code: "unsupported" });
    const claim = await fetch(Deno.env.get("SUPABASE_URL") + "/rest/v1/rpc/claim_event_link_fetch", {
      method: "POST",
      headers: { Authorization: auth, apikey: Deno.env.get("SUPABASE_ANON_KEY")!, "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(5000),
    });
    if (!claim.ok) return json({ code: "unavailable" });
    if (await claim.json() !== true) return json({ code: "limit" });

    const signal = AbortSignal.timeout(9000);
    for (let i = 0; i < 3; i++) {
      const response = await fetch(url, { redirect: "manual", headers: { Accept: "text/html" }, signal });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const destination = response.headers.get("location");
        url = destination ? allowedUrl(new URL(destination, url).href) : null;
        if (!url) return json({ code: "unsupported" });
        continue;
      }
      if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) {
        await response.body?.cancel();
        return json({ code: "unavailable" });
      }
      const draft = eventData(await readText(response.body, 768 * 1024));
      return draft.title ? json({ draft }) : json({ code: "unavailable" });
    }
  } catch {
    // Keep the original URL available in the form when the source cannot be read.
  }
  return json({ code: "unavailable" });
});
