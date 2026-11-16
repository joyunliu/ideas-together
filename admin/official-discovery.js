/* Official/public-source discovery adapter. Discovery is read-only; every candidate requires review. */
const officialHosts = [
  "gov.tw","edu.tw","gov.taipei","ntpc.gov.tw","ntpclib.gov.tw",
  "culture.tw","moc.gov.tw","library.gov.tw"
];
export function isOfficialLink(value) {
  try {
    const url=new URL(value);
    const host=url.hostname.toLowerCase();
    return url.protocol==="https:" && !url.username && !url.password &&
      officialHosts.some(s=>host===s||host.endsWith("."+s));
  }catch{return false}
}
function isPublishedCultureLink(value) {
  try {
    const url=new URL(value);
    return ["https:","http:"].includes(url.protocol) && !url.username && !url.password;
  }catch{return false}
}
const isExhibition=row=>row.details?.exhibition===true || /展覽|特展|展覽會|展出|常設展|永久展|策展|[圖畫攝影藝術文物主題]展/.test(row.title||"");
const permanentExhibition=row=>/常設展|常態展[覽示]|永久(?:性)?展|長期(?:展覽|展示|展出)/.test(row.title||"") ||
  /(?:展覽類型|展出類型|展覽性質)[：:\s]*(?:常設|永久|長期)|(?:本展|此展)(?:覽)?(?:為|屬於)(?:常設|永久|長期)/.test(row.details?.description||"");
const dateOnly=value=>typeof value==="string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
export function prepareCandidate(row, now=Date.now()) {
  if(!row || (!isOfficialLink(row.source_url) &&
    !(row.source_feed==="culture" && isPublishedCultureLink(row.source_url)))) return null;
  const exhibition=isExhibition(row);
  if(exhibition && (permanentExhibition(row)||!dateOnly(row.last_day)))return null;
  const firstDay=row.first_day, lastDay=row.last_day||firstDay;
  if(!dateOnly(firstDay)||!dateOnly(lastDay)||lastDay<firstDay)return null;
  const today=new Date(now+8*3600000).toISOString().slice(0,10);
  const endsAt=Date.parse(row.details?.ends_at);
  if(lastDay<today||(Number.isFinite(endsAt)&&endsAt<=now))return null;
  const allSlots=(Array.isArray(row.details?.schedule)?row.details.schedule:[])
    .filter(x=>x && dateOnly(x.d) && /^\d{2}:\d{2}$/.test(x.s||""))
    .sort((a,b)=>(a.d+a.s).localeCompare(b.d+b.s));
  const schedule=allSlots.filter(x=>x.d>=today &&
    (!/^\d{2}:\d{2}$/.test(x.e||"") || Date.parse(x.d+"T"+x.e+":00+08:00")>now));
  if(!exhibition && allSlots.length && !schedule.length && lastDay===today)return null;
  const day=exhibition?firstDay:(schedule[0]?.d||firstDay);
  const firstSlot=schedule.find(x=>x.d===day);
  const start_at=day+"T"+(firstSlot?.s||"00:00")+":00+08:00";
  const rawFee=String(row.details?.fee_note||"").trim();
  const free=/^(免費|免收費|0元|0|free)$/i.test(rawFee);
  const amounts=[...rawFee.matchAll(/(?:NT\$|新臺幣|新台幣|\$)?\s*(\d{1,5})\s*元/g)].map(x=>Number(x[1]));
  const fee=free?0:amounts.length?Math.min(...amounts):undefined;
  const description=String(row.details?.description||"").trim().slice(0,800);
  const candidate={
    title:String(row.title||"").trim().slice(0,50),
    description,
    start_at,
    city:String(row.city||"").trim(),
    district:String(row.details?.district||"").slice(0,10),
    venue:String(row.venue||"").slice(0,60),
    address:String(row.details?.address||"").slice(0,100),
    link:row.source_url,
    shared_organizer:String(row.organizer||"").slice(0,100),
    fee_note:rawFee.slice(0,60),
    listing_type:exhibition?"exhibition":"event",
    ...(exhibition?{end_at:Number.isFinite(endsAt)?new Date(endsAt).toISOString():lastDay+"T23:59:59+08:00"}:{}),
    audience:"family",
    ...(fee!==undefined?{fee}:{}),
    ...(schedule.length?{schedule}:{}),
  };
  const issues=[];
  const organizer=String(row.organizer||"").trim();
  const officialOrganizer=/(政府|公所|圖書館|文化局|教育局|社會局|國立|市立|縣立|親子館|托育資源中心|博物館|美術館|文化中心|育兒資源中心)/.test(organizer);
  if(!officialOrganizer)issues.push("請確認主辦單位及主辦方的原始公告");
  if(!firstSlot)issues.push("沒有可確認的開始時刻，暫以 00:00 表示；必須人工修正");
  if(!description)issues.push("缺少活動介紹");
  if(!row.city)issues.push("無法判定縣市");
  if(fee===undefined)issues.push("費用尚未確認，不能當成免費");
  issues.push("請確認活動主辦單位、報名狀態、年齡及官方原始公告");
  return {candidate,issues,source:row,officialOrganizer};
}
export function prepareDiscovery(rows,region="全台",category="全部活動",now=Date.now()){
  return (Array.isArray(rows)?rows:[])
    .filter(row=>row && (region==="全台"||String(row.city).replace(/^台/,"臺")===region.replace(/^台/,"臺")))
    .filter(row=>category==="全部活動"||category==="親子活動"||category==="圖書館活動" && /圖書館|圖書|閱讀|故事/.test([row.title,row.venue,row.organizer].join(" ")) || category==="展覽" && isExhibition(row))
    .map(row=>prepareCandidate(row,now)).filter(Boolean);
}
