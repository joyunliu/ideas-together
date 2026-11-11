const origin = "https://joyunliu.github.io";
const cors = {
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: cors });
const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const encode = (data: unknown) => b64url(new TextEncoder().encode(JSON.stringify(data)));
const fetchWithTimeout = (url: string, init: RequestInit) =>
  fetch(url, { ...init, signal: AbortSignal.timeout(10000) });
const tokenUrl = "https://oauth2.googleapis.com/token";
let tokenCache: { value: string; expires: number } | undefined;

async function googleToken(account: {client_email: string; private_key: string}) {
  if (tokenCache && tokenCache.expires > Date.now() + 60000) return tokenCache.value;
  const now = Math.floor(Date.now() / 1000);
  const unsigned = encode({alg:"RS256",typ:"JWT"}) + "." + encode({
    iss: account.client_email, aud: tokenUrl, iat: now, exp: now + 300,
    scope: "https://www.googleapis.com/auth/analytics.readonly",
  });
  const keyBytes = Uint8Array.from(atob(account.private_key.replace(/-----[^-]+-----|\s/g, "")), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", keyBytes,
    {name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"}, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const response = await fetchWithTimeout(tokenUrl, {
    method:"POST",
    body:new URLSearchParams({
      grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion:unsigned + "." + b64url(new Uint8Array(signature)),
    }),
  });
  if (!response.ok) throw new Error("Token request failed");
  const {access_token, expires_in} = await response.json();
  if (typeof access_token !== "string") throw new Error("Missing token");
  tokenCache = {value:access_token,expires:Date.now()+Number(expires_in)*1000};
  return access_token;
}

const dateRanges = [{startDate:"7daysAgo",endDate:"yesterday"}];
const metrics = (...names: string[]) => names.map(name => ({name}));
const breakdown = (name: string, metricName: string) => ({
  dateRanges, dimensions:[{name}], metrics:metrics(metricName), limit:8,
  orderBys:[{metric:{metricName},desc:true}],
});

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response(null, {headers:cors});
  if (request.method !== "POST") return json({error:"method"},405);
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return json({error:"forbidden"},403);
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const headers = {authorization,apikey:Deno.env.get("SUPABASE_ANON_KEY")||""};
    const session = await fetchWithTimeout(supabaseUrl + "/auth/v1/user", {headers});
    if (!session.ok) return json({error:"forbidden"},403);
    const {id} = await session.json();
    if (typeof id !== "string" || !id) return json({error:"forbidden"},403);
    const query = new URLSearchParams({id:"eq."+id,select:"is_admin,suspended",limit:"1"});
    const permission = await fetchWithTimeout(supabaseUrl + "/rest/v1/profiles?" + query, {headers});
    if (!permission.ok) return json({error:"forbidden"},403);
    const [profile] = await permission.json();
    if (profile?.is_admin !== true || profile.suspended === true) return json({error:"forbidden"},403);

    const property = Deno.env.get("GA4_PROPERTY_ID");
    const account = Deno.env.get("GA4_SERVICE_ACCOUNT_JSON");
    if (!property || !/^\d+$/.test(property) || !account) return json({state:"unconfigured"});
    const token = await googleToken(JSON.parse(account));
    const report = await fetchWithTimeout(
      "https://analyticsdata.googleapis.com/v1beta/properties/" + property + ":batchRunReports",
      {method:"POST",headers:{authorization:"Bearer "+token,"Content-Type":"application/json"},
        body:JSON.stringify({requests:[
          {dateRanges,metrics:metrics("activeUsers","sessions","screenPageViews")},
          breakdown("sessionDefaultChannelGroup","sessions"),
          breakdown("pageTitle","screenPageViews"),
        ]})}
    );
    if (!report.ok) throw new Error("Report request failed");
    const {reports} = await report.json();
    const total = reports?.[0]?.rows?.[0]?.metricValues || [];
    type ReportRow = {dimensionValues?: {value?: string}[]; metricValues?: {value?: string}[]};
    const rows = (index: number) => (reports?.[index]?.rows || []).map((row: ReportRow) => ({
      label: row.dimensionValues?.[0]?.value || "未分類",
      count: Number(row.metricValues?.[0]?.value || 0),
    }));
    return json({state:"ready",activeUsers:Number(total[0]?.value||0),sessions:Number(total[1]?.value||0),
      pageViews:Number(total[2]?.value||0),channels:rows(1),pages:rows(2)});
  } catch {
    return json({error:"unavailable"},502);
  }
});
