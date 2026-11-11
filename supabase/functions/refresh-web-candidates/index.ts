const SOURCE = "https://www.gov.taipei/OpenData.aspx?SN=DD102593FDB1A032";
const NATIONAL = "https://cloud.culture.tw/frontsite/trans/SearchShowAction.do?method=doFindTypeJ&category=4";
const SNAPSHOT = "https://raw.githubusercontent.com/joyunliu/ideas-together/culture-feed/culture-feed.json";
const headers = {
  "Access-Control-Allow-Origin": "https://joyunliu.github.io",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
const json = (data: unknown, status = 200) => Response.json(data, {status, headers});
const clean = (value: unknown) => typeof value === "string"
  ? value.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/\s+/g, " ").trim() : "";
const family = /親子|家長|孩子|孩童|兒童|幼兒|小朋友|國小|幼兒園|寶寶/;
const localTime = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)
  ? Date.parse(value + "+08:00") : NaN;
const taipeiDay = (time: number) => new Date(time + 8 * 3600000).toISOString().slice(0,10);

function dateWindow(now: number) {
  const today = taipeiDay(now);
  const [year,month,day] = today.split("-").map(Number);
  const limitMonth = month + 2;
  const limitDay = Math.min(day,new Date(Date.UTC(year,limitMonth+1,0)).getUTCDate());
  return {today,lastAllowed:new Date(Date.UTC(year,limitMonth,limitDay)).toISOString().slice(0,10)};
}

function candidates(source: Record<string, unknown>[], now: number) {
  const {lastAllowed} = dateWindow(now);
  const seen = new Set<string>();
  return source.flatMap(row => {
    if (!row || typeof row !== "object") return [];
    const title = clean(row.title);
    const description = clean(row["內容"]);
    const audience = clean(row["限制對象"]);
    const evidence = family.test(audience) ? audience : family.test(title) ? title :
      description.match(/(?:參加對象|活動對象|適合對象|適合|歡迎)[^。！？\n]{0,25}(?:親子|家長|孩子|孩童|兒童|幼兒|小朋友|國小|幼兒園|寶寶)[^。！？\n]{0,25}/)?.[0];
    const first = localTime(row["活動開始時間"]);
    const last = localTime(row["活動結束時間"]);
    const organizer = clean(row["主辦單位"]);
    const publisher = clean(row["發布單位"]);
    if (!title || !evidence || !Number.isFinite(first) || !Number.isFinite(last) ||
        last <= now || first > last || taipeiDay(first) > lastAllowed) return [];
    let url: URL;
    try { url = new URL(clean(row.Source)); } catch { return []; }
    if (url.protocol !== "https:" || url.hostname !== "www.gov.taipei" || url.username || url.password) return [];
    url.hash = "";
    const link = url.href;
    if (link.length > 200 || seen.has(link)) return [];
    seen.add(link);
    const address = clean(row["活動地址"]);
    const district = address.match(/臺北市([^區\s]{1,3}區)/)?.[1] || "";
    const d = taipeiDay(first), last_day = taipeiDay(last);
    return [{
      source_url: link, title: title.slice(0,140), organizer: organizer.slice(0,100),
      city: "台北市", venue: clean(row["地點"]).slice(0,60), first_day:d, last_day,
      audience_evidence:evidence.slice(0,160),
      review_note:publisher ? "來源：臺北市政府公開活動｜發布單位：" + publisher.slice(0,100) : "來源：臺北市政府公開活動",
      details:{description:description.slice(0,800),district,address:address.slice(0,100),fee_note:clean(row["費用"]).slice(0,60),
        schedule:d===last_day&&first>now&&last>first?[{d,s:String(row["活動開始時間"]).slice(11,16),e:String(row["活動結束時間"]).slice(11,16)}]:[]},
    }];
  }).sort((a,b)=>a.first_day.localeCompare(b.first_day)).slice(0,50);
}

function nationalCandidates(source: Record<string, unknown>[], now: number) {
  const {today,lastAllowed}=dateWindow(now);
  const cityName=/台北市|新北市|基隆市|桃園市|新竹市|新竹縣|苗栗縣|台中市|彰化縣|南投縣|雲林縣|嘉義市|嘉義縣|台南市|高雄市|屏東縣|宜蘭縣|花蓮縣|台東縣|澎湖縣|金門縣|連江縣/;
  const date=(value:unknown)=>clean(value).replaceAll("/","-");
  return source.flatMap(row=>{
    if(!row || typeof row!=="object")return [];
    const title=clean(row.title), first_day=date(row.startDate), last_day=date(row.endDate);
    if(!title||!/^\d{4}-\d{2}-\d{2}$/.test(first_day)||!/^\d{4}-\d{2}-\d{2}$/.test(last_day)||
       last_day<today||first_day>lastAllowed||last_day<first_day)return [];
    const description=clean(row.descriptionFilterHtml);
    const evidence=family.test(title)?title:
      description.match(/(?:參加對象|活動對象|適合對象|適合|歡迎)[^。！？]{0,25}(?:親子|家長|孩子|孩童|兒童|幼兒|小朋友|國小|幼兒園|寶寶)[^。！？]{0,25}/)?.[0];
    if(!evidence)return [];
    let link="";
    for(const value of [row.sourceWebPromote,row.webSales]){
      try{
        const url=new URL(clean(value));
        if(!["https:","http:"].includes(url.protocol)||url.username||url.password)continue;
        url.hash="";
        if(url.href.length<=200){link=url.href;break}
      }catch{/* Continue to the other published link. */}
    }
    if(!link)return [];
    const slots=Array.isArray(row.showInfo)?row.showInfo.filter(slot=>slot&&typeof slot==="object"):[];
    const slot=slots.find(slot=>date(slot.time).slice(0,10)>=today)||slots[0];
    const address=clean(slot?.location).replaceAll("臺","台");
    const city=address.match(cityName)?.[0]||"";
    const district=city?address.slice(address.indexOf(city)+city.length).trimStart().match(/^([^\s區]{1,4}區)/)?.[1]||"":"";
    const venue=clean(slot?.locationName);
    const schedule=slots.filter(s=>clean(s.locationName)===venue&&clean(s.location).replaceAll("臺","台")===address).flatMap(s=>{
      const first=date(s.time).replace(" ","T"),last=date(s.endTime).replace(" ","T");
      if(!(localTime(first)>now)||!(localTime(last)>localTime(first))||first.slice(0,10)!==last.slice(0,10)||
         first.slice(11,16)==="00:00"||last.slice(11,16)==="23:59")return [];
      return [{d:first.slice(0,10),s:first.slice(11,16),e:last.slice(11,16)}];
    }).slice(0,20);
    return [{
      source_url:link,title:title.slice(0,140),organizer:(Array.isArray(row.masterUnit)?row.masterUnit:[row.masterUnit]).map(clean).filter(Boolean).join("、").slice(0,100),
      city,venue:venue.slice(0,60),first_day,last_day,audience_evidence:evidence.slice(0,160),
      review_note:"來源：文化部全國親子活動開放資料",
      details:{description:description.slice(0,800),address:address.slice(0,100),district,schedule,fee_note:clean(slot?.price).slice(0,60)},
    }];
  });
}

async function readSource(url: string) {
  const response=await fetch(url,{headers:{Accept:"application/json"},cache:"no-store",signal:AbortSignal.timeout(6500)});
  if(!response.ok)throw new Error("source unavailable");
  return await response.json();
}

async function readNational(){
  try{
    const rows=await readSource(NATIONAL);
    if(Array.isArray(rows))return {rows,backup:false};
  }catch{/* Use the last successful nationwide snapshot when the live feed fails. */}
  const snapshot=await readSource(SNAPSHOT);
  if(!Array.isArray(snapshot?.items))throw new Error("snapshot unavailable");
  return {rows:snapshot.items,backup:true};
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response(null,{headers});
  if (request.method !== "POST") return json({error:"method"},405);
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return json({error:"forbidden"},403);
  try {
    const signal = AbortSignal.timeout(12000);
    const api = Deno.env.get("SUPABASE_URL");
    const authHeaders = {authorization, apikey:Deno.env.get("SUPABASE_ANON_KEY")||""};
    const admin = await fetch(api+"/rest/v1/rpc/is_admin",{
      method:"POST",headers:{...authHeaders,"Content-Type":"application/json"},body:"{}",signal,
    });
    if (!admin.ok || await admin.json() !== true) return json({error:"forbidden"},403);
    const [national,taipei]=await Promise.allSettled([readNational(),readSource(SOURCE)]);
    const now=Date.now();
    const taipeiRows=taipei.status==="fulfilled"&&Array.isArray(taipei.value)?taipei.value:null;
    const nationwide=national.status==="fulfilled"?national.value:null;
    if(!nationwide&&!taipeiRows)return json({error:"source_unavailable"},502);
    const rows=[...(nationwide?nationalCandidates(nationwide.rows,now):[]),...(taipeiRows?candidates(taipeiRows,now):[])];
    const unique=[...new Map(rows.map(row=>[row.source_url,row])).values()].sort((a,b)=>a.first_day.localeCompare(b.first_day));
    return json({rows:unique,checked:(nationwide?.rows.length||0)+(taipeiRows?.length||0),updated_at:new Date(now).toISOString(),
      national_source:nationwide?(nationwide.backup?"snapshot":"live"):"unavailable",taipei_source:!!taipeiRows});
  } catch {
    return json({error:"source_unavailable"},502);
  }
});
