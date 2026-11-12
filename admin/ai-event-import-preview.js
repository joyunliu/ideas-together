/* AI event import: pure validation/preview, no database writes or credentials.
   Import this module from the admin UI. All records must be reviewed before insertion. */
const LIMITS = { title:50, description:800, link:200, venue:60, district:10, address:100, fee_note:60 };
const allowedTypes = new Set(["event","exhibition","resource"]);
const allowedAudience = new Set(["family","kids","parents"]);
const normalize = value => String(value ?? "").normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu,"");
const canonicalUrl = value => {
  try {
    const url = new URL(String(value));
    if (!["https:","http:"].includes(url.protocol) || url.username || url.password) return "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    return url.toString().replace(/\/$/,"");
  } catch { return ""; }
};
const validDate = value => typeof value === "string" && !Number.isNaN(Date.parse(value));
const similar = (a,b) => !!a && !!b && (a===b || (Math.min(a.length,b.length)>=5 && (a.includes(b)||b.includes(a))));
export function inspectEvent(candidate, existing=[]) {
  const errors=[], warnings=[];
  if (!candidate || typeof candidate!=="object" || Array.isArray(candidate)) return {state:"invalid",errors:["資料必須是物件"],warnings,duplicates:[]};
  const title=String(candidate.title??"").trim(), city=String(candidate.city??"").trim();
  if (!title || title.length>LIMITS.title) errors.push("活動名稱必填，最多50字");
  if (!city) errors.push("縣市必填");
  if (!String(candidate.description??"").trim()) errors.push("活動介紹必填");
  if (candidate.continuous && !candidate.recurrence_note && !candidate.schedule) errors.push("常態活動須有時段或更新方式");
  if (["full","cancelled"].includes(candidate.booking_status)) errors.push("額滿或取消的活動不得批次匯入");
  if (candidate.status && candidate.status!=="pending") errors.push("只允許建立待審核活動");
  for (const [field,max] of Object.entries(LIMITS)) {
    if (field==="title") continue;
    if (candidate[field]!=null && String(candidate[field]).length>max) errors.push(`${field} 超過 ${max} 字`);
  }
  if (!validDate(candidate.start_at)) errors.push("缺少有效開始時間");
  if (candidate.end_at && (!validDate(candidate.end_at) || Date.parse(candidate.end_at)<Date.parse(candidate.start_at))) errors.push("結束時間不正確");
  if (candidate.age_min!=null && (!Number.isInteger(candidate.age_min)||candidate.age_min<0||candidate.age_min>12)) errors.push("最小年齡須為0–12歲");
  if (candidate.age_max!=null && (!Number.isInteger(candidate.age_max)||candidate.age_max<0||candidate.age_max>12)) errors.push("最大年齡須為0–12歲");
  if (candidate.age_min>candidate.age_max) errors.push("年齡範圍顛倒");
  if (candidate.fee!=null && (!Number.isInteger(candidate.fee)||candidate.fee<0||candidate.fee>100000)) errors.push("費用須為0–100000元整數");
  if (candidate.listing_type && !allowedTypes.has(candidate.listing_type)) errors.push("活動分類無效");
  if (candidate.audience && !allowedAudience.has(candidate.audience)) errors.push("參加對象無效");
  const url=canonicalUrl(candidate.link);
  if (candidate.source_verified!==true) warnings.push("官方／公共來源尚未經人工驗證");
  if (!url) errors.push("缺少有效官方活動連結");
  
  
  
  const name=normalize(title), place=normalize(candidate.venue), organizer=normalize(candidate.shared_organizer);
  const duplicates=existing.filter(row=>{
    const otherUrl=canonicalUrl(row.link);
    if (url && otherUrl && url===otherUrl) return true;
    if (normalize(row.city)!==normalize(city) || !similar(name,normalize(row.title))) return false;
    const samePlace=place && normalize(row.venue)===place;
    const sameOrganizer=organizer && normalize(row.shared_organizer)===organizer;
    if (candidate.continuous && row.continuous) return !!(samePlace||sameOrganizer);
    return !!(samePlace||sameOrganizer) && String(row.start_at??"").slice(0,10)===String(candidate.start_at??"").slice(0,10);
  }).map(row=>({id:row.id,title:row.title,link:row.link}));
  if (duplicates.length) warnings.push("疑似重複活動，請人工確認");
  return {state:errors.length?"invalid":duplicates.length?"duplicate":warnings.length?"review":"ready",errors,warnings,duplicates};
}
export function previewImport(candidates,existing=[]) {
  if (!Array.isArray(candidates) || candidates.length>100) throw Error("每批最多100筆");
  const prior=[...existing],results=[];
  for (const candidate of candidates) {
    const result=inspectEvent(candidate,prior);
    results.push({candidate,result});
    if (result.state!=="invalid") prior.push(candidate);
  }
  return results;
}
