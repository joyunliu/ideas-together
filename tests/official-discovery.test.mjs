// Run with: node --test tests/official-discovery.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const src=await readFile(new URL("../admin/official-discovery.js",import.meta.url),"utf8");
const {isOfficialLink,prepareDiscovery:discover}=await import("data:text/javascript;base64,"+Buffer.from(src).toString("base64"));
const prepareDiscovery=(rows,region,category,now=Date.parse("2026-11-16T00:00:00Z"))=>discover(rows,region,category,now);
const base={title:"親子閱讀活動",source_url:"https://www.gov.taipei/events/123",first_day:"2026-12-01",city:"台北市",venue:"圖書館",organizer:"公共圖書館",details:{description:"親子共讀活動",fee_note:"免費",schedule:[{d:"2026-12-01",s:"10:00",e:"11:00"}]}};
test("accepts public source and rejects spoofed or private URLs",()=>{
  assert.equal(isOfficialLink(base.source_url),true);
  assert.equal(isOfficialLink("https://gov.tw.evil.example/event"),false);
  assert.equal(isOfficialLink("https://example.org/event"),false);
  assert.equal(isOfficialLink("http://www.gov.taipei/event"),false);
});
test("maps verified free activity and start time",()=>{
  const rows=prepareDiscovery([base]);
  assert.equal(rows.length,1);
  assert.equal(rows[0].candidate.fee,0);
  assert.equal(rows[0].candidate.start_at,"2026-12-01T10:00:00+08:00");
});
test("unknown fee remains unknown, not free",()=>{
  const rows=prepareDiscovery([{...base,details:{...base.details,fee_note:"依公告"}}]);
  assert.equal(rows[0].candidate.fee,undefined);
  assert.ok(rows[0].issues.some(x=>x.includes("費用")));
});
test("filters region and private sources",()=>{
  assert.equal(prepareDiscovery([base],"新北市").length,0);
  assert.equal(prepareDiscovery([{...base,source_url:"https://private.example/event"}]).length,0);
});

test("flags unverified private organizer in public data",()=>{
  const rows=prepareDiscovery([{...base,organizer:"私人活動公司"}]);
  assert.equal(rows.length,1);
  assert.equal(rows[0].officialOrganizer,false);
  assert.ok(rows[0].issues.some(x=>x.includes("主辦方")));
});

test("filters ended sessions and permanent exhibitions, including when all activities are selected",()=>{
  const now=Date.parse("2026-12-01T12:00:00+08:00");
  const rows=prepareDiscovery([
    base,
    {...base,title:"博物館常設展",last_day:"2030-12-31"},
    {...base,title:"親子短期特展",first_day:"2026-11-01",last_day:"2026-12-05",details:{exhibition:true}},
    {...base,title:"明天的親子活動",last_day:"2026-12-02",details:{schedule:[...base.details.schedule,{d:"2026-12-02",s:"09:00",e:"10:00"}]}},
  ],"臺北市","全部活動",now);
  assert.deepEqual(rows.map(row=>row.candidate.title),["親子短期特展","明天的親子活動"]);
  assert.equal(rows[0].candidate.listing_type,"exhibition");
  assert.equal(rows[0].candidate.end_at,"2026-12-05T23:59:59+08:00");
  assert.equal(rows[1].candidate.start_at,"2026-12-02T09:00:00+08:00");
});

test("accepts organizer links carried by the culture feed",()=>{
  const rows=prepareDiscovery([{...base,source_feed:"culture",source_url:"https://foundation.example/event"}],"全台","全部活動",Date.parse("2026-11-16T00:00:00Z"));
  assert.equal(rows.length,1);
  assert.match(rows[0].issues.join(" "),/主辦單位/);
});
