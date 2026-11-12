// Exercises the real form, savePost, review and detail code with an isolated mock backend.
// No live Supabase records are created. The clock is fixed for the reported exhibition.
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const mockSDK=`window.testRows=[];window.testWrites=[];window.supabase={createClient:()=>({
 auth:{onAuthStateChange(){}},rpc:async()=>({data:[]}),
 storage:{from:()=>({remove:async()=>({}),getPublicUrl:()=>({data:{publicUrl:''}})})},
 from(table){let op='select',value,filters=[],single=false,done=false,result;
 const query=new Proxy({}, {get(_,name){
  if(name==='then')return (resolve,reject)=>Promise.resolve().then(()=>{
   if(done)return result;done=true;
   let rows=table==='events'?window.testRows:[];
   const match=r=>filters.every(([key,v])=>r[key]===v);
   if(op==='insert'){const row={id:crypto.randomUUID(),...value};rows.push(row);window.testWrites.push({op,row:structuredClone(row)});result={data:single?row:[row]};}
   else if(op==='update'){const selected=rows.filter(match);selected.forEach(r=>Object.assign(r,value));window.testWrites.push({op,row:structuredClone(selected[0])});result={data:single?selected[0]||null:selected};}
   else result={data:single?rows.filter(match)[0]||null:rows.filter(match).map(r=>({...r,profiles:{nickname:'測試主辦方'}}))};
   return result;
  }).then(resolve,reject);
  return (...args)=>{if(name==='insert'||name==='update'){op=name;value=args[0]}
   if(name==='eq'||name==='is')filters.push(args);if(name==='single'||name==='maybeSingle')single=true;return query};
 }});return query;}
})};`;
(async()=>{
 let html=fs.readFileSync('index.html','utf8');
 // Expose private validation only in the in-memory test page.
 html=html.replace('return{S,ensure,reset,show,openQuick,','return{readTiming,detailHTML,visitSettings,noFixedTime,publiclyListed,S,ensure,reset,show,openQuick,');
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install({time:new Date('2026-11-12T04:00:00Z')});
  await page.route('**/*',async route=>{
   const url=route.request().url();
   if(url.includes('supabase.min.js'))return route.fulfill({contentType:'text/javascript',body:mockSDK});
   if(url==='https://app.test/')return route.fulfill({contentType:'text/html',body:html});
   if(url==='https://app.test/assets/parenting-resources.js')return route.fulfill({contentType:'text/javascript',body:fs.readFileSync('assets/parenting-resources.js','utf8')});
   await route.abort();
  });
  await page.goto('https://app.test/');
  await page.evaluate(()=>{AUTH.u={id:'00000000-0000-0000-0000-000000000001'};AUTH.me={nickname:'測試家長',account_type:'personal'};E.openDraft()});
  assert(await page.evaluate(()=>!!(document.querySelector('#event-ft').compareDocumentPosition(document.querySelector('#event-organizer'))&Node.DOCUMENT_POSITION_FOLLOWING)));
  await page.fill('#event-ft','長期展覽測試');
  await page.selectOption('#event-listing-type','exhibition');
  await page.check('[name=event-fk][value=range]');
  await page.fill('#event-fr1','2026-10-03');await page.fill('#event-fr2','2027-02-21');
  await page.check('#event-no-time');await page.check('[name=event-closed-day][value="1"]');
  let timing=await page.evaluate(()=>E.readTiming(false));
  assert(!timing.error,timing.error);assert.equal(timing.row.start_at,'2026-10-02T16:00:00.000Z');
  assert.equal(timing.row.end_at,'2027-02-21T15:59:59.000Z');assert.equal(timing.row.flex_time,false);
  assert.match(timing.row.visit_note,/無特定時間/);assert.match(timing.row.visit_note,/每週一/);
  // New option states survive draft storage and restoration.
  await page.click('[data-save-draft]');
  await page.evaluate(()=>{const draft=readDrafts('event')[0];E.openDraft(null,draft)});
  assert(await page.isChecked('#event-no-time'));assert(!await page.isChecked('#event-fx'));
  assert(await page.isChecked('[name=event-closed-day][value="1"]'));
  // Complete real submission and inspect actual payload sent through savePost.
  await page.click('[data-next]');await page.selectOption('#event-fc','台北市');
  await page.fill('#event-fv','測試展覽館');await page.fill('#event-fh','測試展覽內容');
  await page.click('[data-next]');assert.match(await page.locator('.post-preview').innerText(),/2027年2月21日/);await page.click('[data-submit]');
  await page.waitForFunction(()=>testRows.length===1);
  let saved=await page.evaluate(()=>testRows[0]);assert.equal(saved.status,'pending');
  assert.equal(saved.end_at,timing.row.end_at);assert.equal(saved.visit_note,timing.row.visit_note);
  // Reopen saved event, separate reservation from fixed opening hours, and save again.
  await page.evaluate(()=>E.openDraft(testRows[0]));
  assert(await page.isChecked('#event-no-time'));assert(await page.isChecked('[name=event-closed-day][value="1"]'));
  await page.uncheck('#event-no-time');await page.check('#event-fx');
  await page.selectOption('#event-fs1h','09');await page.fill('#event-fs1m','30');
  await page.selectOption('#event-fe1h','17');await page.fill('#event-fe1m','00');
  timing=await page.evaluate(()=>E.readTiming(false));assert(!timing.error,timing.error);assert.equal(timing.row.flex_time,true);
  assert.equal(timing.row.start_at,'2026-10-03T01:30:00.000Z');assert.equal(timing.row.end_at,'2027-02-21T09:00:00.000Z');
  await page.click('[data-next]');await page.click('[data-next]');await page.click('[data-submit]');
  await page.waitForFunction(()=>testWrites.length===2);
  // Real admin review function approves the preserved row in the isolated backend.
  await page.evaluate(async()=>{
   AUTH.me={is_admin:true,suspended:false};const row=testRows[0];E.S.ev=[row];
   const section=document.createElement('section'),button=document.createElement('button');section.append(button);document.body.append(section);
   await reviewPost(button,'events',row,{status:'approved',reject_reason:null});
  });
  saved=await page.evaluate(()=>testRows[0]);assert.equal(saved.status,'approved');
  let display=await page.evaluate(()=>({text:E.exhibitionVisit(testRows[0]),listed:E.publiclyListed(testRows[0]),html:E.detailHTML({...testRows[0],profiles:{nickname:'測試家長'}})}));
  assert(display.listed);assert.match(display.text,/09:30–17:00/);assert.match(display.text,/每週一/);assert.match(display.text,/可自行預約/);
  assert.match(display.html,/09:30–17:00/);assert.match(display.html,/每週一/);
  // Date/range and no-time regressions use the same actual form validator.
  await page.evaluate(()=>E.openDraft(testRows[0]));
  // A genuine 23:59 exhibition closing time must not be mistaken for a sentinel.
  await page.selectOption('#event-fe1h','23');await page.fill('#event-fe1m','59');
  const late=await page.evaluate(()=>({...E.readTiming(false).row,listing_type:'exhibition'}));
  assert.match(await page.evaluate(row=>E.exhibitionVisit(row),late),/09:30–23:59/);
  await page.evaluate(row=>E.openDraft({...testRows[0],...row}),late);
  assert.equal(await page.inputValue('#event-fe1h'),'23');assert.equal(await page.inputValue('#event-fe1m'),'59');
  await page.selectOption('#event-fe1h','17');await page.fill('#event-fe1m','00');
  await page.fill('#event-fr2','2029-02-21');assert(!(await page.evaluate(()=>E.readTiming(false))).error);
  await page.fill('#event-fr2','2026-10-02');assert.match((await page.evaluate(()=>E.readTiming(false))).error,/結束日期/);
  await page.fill('#event-fr2','2026-10-20');assert.match((await page.evaluate(()=>E.readTiming(false))).error,/展覽已結束/);
  await page.check('[name=event-fk][value=single]');await page.fill('#event-fd1','2026-11-12');
  await page.uncheck('#event-fx');await page.check('#event-no-time');
  timing=await page.evaluate(()=>E.readTiming(false));assert(!timing.error,timing.error);assert.equal(timing.row.end_at,'2026-11-12T15:59:59.000Z');
  await page.uncheck('#event-no-time');await page.selectOption('#event-fe1h','08');
  assert.match((await page.evaluate(()=>E.readTiming(false))).error,/結束時間需晚於開始時間/);
  await page.selectOption('#event-fe1h','17');await page.fill('#event-fs1m','60');
  assert.match((await page.evaluate(()=>E.readTiming(false))).error,/分鐘/);
  await page.fill('#event-fs1m','30');await page.selectOption('#event-fe1h','');
  assert.match((await page.evaluate(()=>E.readTiming(false))).error,/完整的每日開放時間/);
  await page.check('#event-no-time');await page.selectOption('#event-listing-type','event');
  timing=await page.evaluate(()=>E.readTiming(false));assert(!timing.error,timing.error);assert.equal(timing.row.flex_time,false);
  for(const type of ['exhibition','event']){
   await page.evaluate(()=>{AUTH.me={nickname:'測試家長',account_type:'personal'};E.openDraft()});
   await page.fill('#event-ft',type==='exhibition'?'單日無固定時間展覽':'無固定時間活動');
   await page.selectOption('#event-listing-type',type);await page.check('[name=event-fk][value=single]');
   await page.fill('#event-fd1','2026-11-13');await page.check('#event-no-time');
   const count=await page.evaluate(()=>testRows.length);
   await page.click('[data-next]');await page.selectOption('#event-fc','台北市');
   await page.fill('#event-fh','單日無固定時間測試內容');await page.click('[data-next]');await page.click('[data-submit]');
   await page.waitForFunction(count=>testRows.length===count+1,count);
   const record=await page.evaluate(()=>testRows.at(-1));assert.equal(record.status,'pending');assert.equal(record.flex_time,false);
   assert.equal(record.end_at,'2026-11-13T15:59:59.000Z');assert.match(record.visit_note,/無特定時間/);
   await page.evaluate(async()=>{AUTH.me={is_admin:true,suspended:false};const row=testRows.at(-1);
    const section=document.createElement('section'),button=document.createElement('button');section.append(button);document.body.append(section);
    await reviewPost(button,'events',row,{status:'approved',reject_reason:null});});
   assert(await page.evaluate(()=>testRows.at(-1).status==='approved'&&E.publiclyListed(testRows.at(-1))));
  }
  assert.deepEqual(errors,[]);
  console.log('PASS:',width,'px; ongoing/long/single exhibitions, independent timing/booking, closures, draft and saved-row round trips, real save/review code with mock backend, invalid dates/times, untimed activity');
  await page.close();
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
