const {readFileSync}=require("node:fs");
const {stripTypeScriptTypes}=require("node:module");
const vm=require("node:vm");
const assert=require("node:assert/strict");
const code=stripTypeScriptTypes(readFileSync("supabase/functions/refresh-web-candidates/index.ts","utf8"));
const now=Date.parse("2026-11-11T04:00:00Z");
let run,allowed=false,sourceCalls=0;
const ctx=vm.createContext({Response,AbortSignal,URL,Date,Deno:{env:new Map(),serve:fn=>{run=fn}},
  fetch:async url=>{
    if(url.includes("/rpc/is_admin"))return Response.json(allowed);
    sourceCalls++;
    return Response.json([]);
  }});
vm.runInContext(code,ctx);
const good={title:"親子工作坊",Source:"https://www.gov.taipei/News_Content.aspx?s=1",
 "活動開始時間":"2026-11-11T14:00:00","活動結束時間":"2026-11-11T16:00:00"};
const rows=[good,good,{...good,title:"徵才",Source:good.Source+"2"},
  {...good,Source:good.Source+"3","活動結束時間":"2026-11-11T11:00:00"},
  {...good,Source:"https://example.invalid/"},
  {...good,Source:good.Source+"4","活動開始時間":"2027-02-12T14:00:00","活動結束時間":"2027-02-12T16:00:00"}];
const result=ctx.candidates(rows,now);
assert.equal(result.length,1);
assert.equal(result[0].details.schedule[0].s,"14:00");
assert.equal(result[0].organizer,"");
const national=ctx.nationalCandidates([
  {title:"花蓮親子工作坊",startDate:"2026/11/12",endDate:"2026/11/12",sourceWebPromote:"https://example.org/hualien",showInfo:[{location:"花蓮縣花蓮市",locationName:"活動中心"}]},
  {title:"金門親子活動",startDate:"2026/11/14",endDate:"2026/11/14",sourceWebPromote:"https://example.org/kinmen",showInfo:[{location:"金門縣金城鎮"}]}
],now);
assert.equal(Array.from(national,row=>row.city).join(","),"花蓮縣,金門縣");
(async()=>{
  const request={method:"POST",headers:new Headers({authorization:"Bearer test"})};
  assert.equal((await run(request)).status,403);
  assert.equal(sourceCalls,0);
  allowed=true;
  assert.equal((await (await run(request)).json()).checked,0);
  if(process.argv[2]){
    const source=JSON.parse(readFileSync(process.argv[2],"utf8").replace(/^\uFEFF/,""));
    const rows=Array.isArray(source)?source:source.items;
    assert(Array.isArray(rows)&&rows.length>0);
    const live=Array.isArray(source)?ctx.candidates(rows,Date.now()):ctx.nationalCandidates(rows,Date.now());
    console.log("Source:",rows.length,"rows;",live.length,"family candidates;",[...new Set(live.map(row=>row.city).filter(Boolean))].join(","));
  }
  console.log("PASS: candidate filtering, duplicate rejection, admin access and refreshed response");
})().catch(e=>{console.error(e);process.exitCode=1});
