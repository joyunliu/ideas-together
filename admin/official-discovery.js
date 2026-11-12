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
export function prepareCandidate(row) {
  if(!row || !isOfficialLink(row.source_url)) return null;
  const day=String(row.first_day||"");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return null;
  const schedule=Array.isArray(row.details?.schedule)?row.details.schedule:[];
  const firstSlot=schedule.find(x=>x.d===day && /^\d{2}:\d{2}$/.test(x.s||""));
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
    listing_type:"event",
    audience:"family",
    ...(fee!==undefined?{fee}:{}),
    ...(schedule.length?{schedule}:{}),
  };
  const issues=[];
  const organizer=String(row.organizer||"").trim();
  const officialOrganizer=/(政府|公所|圖書館|文化局|教育局|社會局|國立|市立|縣立|親子館|托育資源中心|博物館|美術館|文化中心|育兒資源中心)/.test(organizer);
  if(!officialOrganizer)issues.push("資料來自官方開放資料，但主辦方未確認為公共機關；請核對原始公告");
  if(!firstSlot)issues.push("沒有可確認的開始時刻，暫以 00:00 表示；必須人工修正");
  if(!description)issues.push("缺少活動介紹");
  if(!row.city)issues.push("無法判定縣市");
  if(fee===undefined)issues.push("費用尚未確認，不能當成免費");
  issues.push("請確認活動主辦單位、報名狀態、年齡及官方原始公告");
  return {candidate,issues,source:row,officialOrganizer};
}
export function prepareDiscovery(rows,region="全台",category="全部活動"){
  return (Array.isArray(rows)?rows:[])
    .filter(row=>region==="全台"||row.city===region)
    .filter(row=>category==="全部活動"||category==="親子活動"||category==="圖書館活動" && /圖書館|圖書|閱讀|故事/.test([row.title,row.venue,row.organizer].join(" ")) || category==="展覽" && /展覽|特展|展出/.test(row.title||""))
    .map(prepareCandidate).filter(Boolean);
}
