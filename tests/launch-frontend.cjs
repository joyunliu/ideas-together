const assert=require("node:assert/strict"), fs=require("node:fs"), vm=require("node:vm");
const html=fs.readFileSync("index.html","utf8");
const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(x=>x[1]);
for(const script of scripts)new vm.Script(script);
const c=vm.createContext({window:{},document:{createElement:()=>({}),head:{append(){}}}});
vm.runInContext(scripts[0],c);
vm.runInContext(`
analytics.pageView("#/");
analytics.pageView("#/events");
analytics.pageView("#/events/e/opaque-id?slot=secret");
analytics.pageView("#/events/e/opaque-id?slot=different");
analytics.pageView("#/admin");
analytics.pageView("#/account?email=secret");
analytics.pageView("#/about");
analytics.event("search_activity",{method:"keyword"});
`,c);
const tags=Array.from(c.window.dataLayer,x=>Array.from(x));
assert.deepEqual(tags.filter(x=>x[1]==="page_view").map(x=>x[2].page_location.split("#")[1]),["/","/events","/events/e","/about"]);
assert(!/opaque-id|secret|different/.test(JSON.stringify(tags)));
assert.equal(tags.find(x=>x[1]==="search_activity")[2].method,"keyword");
const block=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));
const event=vm.createContext({Date,S:{}});
const helpers=block("const d0=","const isOrg=e=>e.profiles");
const policy=block("const listingType=","const exhibitionDates=");
const prices=block("const feeType=","const nick=e=>");
vm.runInContext(helpers+"\n"+policy+"\n"+prices,event);
const check=code=>vm.runInContext(code,event);
assert.equal(check('windowEnd(new Date("2026-11-30T16:30:00Z"))'),"2027-03-01");
assert.equal(check('windowEnd(new Date("2026-01-31T04:00:00Z"))'),"2026-04-30");
check(`const now=new Date("2026-11-11T03:00:00Z");
const e={start_at:"2026-11-11T01:00:00+08:00",listing_type:"event",schedule:[
 {d:"2026-11-11",s:"01:00",e:"02:00"}, {d:"2026-11-11",s:"10:00",e:"12:00"},
 {d:"2027-02-11",s:"09:00",e:"10:00"}, {d:"2027-02-12",s:"09:00",e:"10:00"}]};`);
assert.equal(check('upcomingSlots(e,now).map(s=>s.d).join(",")'),"2026-11-11,2027-02-11");
assert.equal(check('upcomingSlots({...e,listing_type:"resource"},now).length'),3);
assert.equal(check('feeTxt({fee:0})'),"免費");
assert.equal(check('feeTxt({fee:500})'),"NT$ 500");
assert.equal(check('feeTxt({fee:350,fee_type:"range"})'),"NT$ 350 起");
assert.equal(check('feeTxt({fee:0,fee_type:"announcement"})'),"費用依公告");
assert.equal(check('feeMatches({fee:0,fee_type:"announcement"},"500")'),false);
assert.equal(check('feeMatches({fee:0,fee_type:"range"},"free")'),false);
console.log("PASS: inline script syntax, analytics redaction/deduplication, Taipei date rules, legacy and structured prices");

async function checkReview(){
  const updates=[], removed=[], messages=[], notices=[];
  const auth={me:{is_admin:true,suspended:false}};
  const buttons=[{disabled:false},{disabled:false}];
  const button={closest:()=>({querySelectorAll:()=>buttons})};
  const post={id:"test-post",status:"pending"};
  let result={data:{id:post.id}};
  const sb={
    from(table){
      const filters=[];
      return {
        update(changes){updates.push({table,changes,filters});return this},
        eq(key,value){filters.push([key,value]);return this},
        select(){return this},
        async maybeSingle(){assert(buttons.every(b=>b.disabled));return result}
      };
    },
    storage:{from:()=>({async remove(photos){removed.push(...photos);return {}}})}
  };
  const ctx=vm.createContext({AUTH:auth,ACT:{},esc:s=>s,sb,G:{reset(){}},E:{reset(){}},
    location:{hash:"#/events/e/test-post"},go:path=>notices.push(path),alert:m=>messages.push(m),showToast:m=>messages.push(m)});
  vm.runInContext(block("const canReview=","const go=h=>"),ctx);
  const {reviewActions,reviewPost}=ctx;
  assert.match(reviewActions("e",post,["資訊不完整"]),/核准/);
  await reviewPost(button,"events",post,{status:"approved",reject_reason:null});
  await reviewPost(button,"events",post,{status:"rejected",reject_reason:"資訊不完整"},["test.webp"]);
  assert.deepEqual(updates.map(x=>x.changes.status),["approved","rejected"]);
  assert.deepEqual(updates[1].filters,[["id",post.id],["status","pending"]]);
  assert.deepEqual(removed,["test.webp"]);
  assert.deepEqual(notices,["#/admin","#/admin"]);
  result={data:null};
  await reviewPost(button,"events",post,{status:"rejected"},["keep.webp"]);
  assert.deepEqual(removed,["test.webp"]);
  assert.match(messages.at(-1),/狀態已變更/);
  assert(buttons.every(b=>!b.disabled));
  for(const me of [{is_admin:false,suspended:false},{is_admin:true,suspended:true}]){
    auth.me=me;
    assert.equal(reviewActions("e",post,[]),"");
    await reviewPost(button,"events",post,{status:"approved"});
  }
  assert.equal(updates.length,3);
  console.log("PASS: activity approval, rejection reason, stale review and frontend permission guards");
}
checkReview().catch(error=>{console.error(error);process.exitCode=1});
