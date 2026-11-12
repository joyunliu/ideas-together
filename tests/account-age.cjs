const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const mockSDK=require('./helpers/supabase-mock.cjs');
(async()=>{
 const html=fs.readFileSync('index.html','utf8');
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install({time:new Date('2026-11-12T04:00:00Z')});
  await page.route('**/*',async route=>{
   const url=route.request().url();
   if(url.includes('supabase.min.js'))return route.fulfill({contentType:'text/javascript',body:mockSDK});
   if(url==='https://app.test/')return route.fulfill({contentType:'text/html',body:html});
   if(url==='https://app.test/assets/parenting-resources.js')return route.fulfill({contentType:'text/javascript',body:fs.readFileSync('assets/parenting-resources.js','utf8')});
   await route.abort();
  });
  await page.goto('https://app.test/');
  await page.evaluate(()=>{AUTH.u={id:'00000000-0000-0000-0000-000000000001',email:'test@example.invalid'};AUTH.me={nickname:'測試家長',account_type:'personal'}});
  for(const mode of ['3-4','0-12','custom','months','official','import']){
   await page.evaluate(mode=>{
    if(mode==='import')E.openDraft(null,{id:crypto.randomUUID(),fields:[{id:'event-age-preset',type:'select-one',value:'0-12'}],culture:{web:true,title:'匯入年齡測試',link:'https://example.invalid/event'}});
    else E.openDraft();
   },mode);
   await page.fill('#event-ft','年齡整合測試 '+mode);await page.selectOption('#event-source','shared');
   await page.fill('#event-organizer','測試公共機構');await page.selectOption('#event-listing-type','exhibition');
   await page.check('[name=event-fk][value=single]');await page.fill('#event-fd1','2026-11-13');await page.check('#event-no-time');
   await page.click('[data-next]');await page.selectOption('#event-fc','台北市');await page.selectOption('#event-fz','中正區');
   await page.fill('#event-fv','測試館舍');await page.fill('#event-fh','測試活動說明');await page.fill('#event-fl','https://example.invalid/event');
   await page.selectOption('#event-fau','family');await page.selectOption('#event-fee-type','free');
   if(mode==='3-4'){
    // Stale values from other modes must not override the selected age range.
    await page.selectOption('#event-age-preset','official');await page.fill('#event-age-detail','小一至小三');
    await page.selectOption('#event-age-preset','months');await page.fill('#event-age-min-month','18');await page.fill('#event-age-max-month','36');
   }
   await page.selectOption('#event-age-preset',mode==='import'?'0-12':mode);
   if(mode==='custom'){await page.selectOption('#event-fa1','2');await page.selectOption('#event-fa2','5')}
   if(mode==='months'){await page.fill('#event-age-min-month','6');await page.fill('#event-age-max-month','18')}
   if(mode==='official')await page.fill('#event-age-detail','小一至小三');
   if(!['months','official','custom'].includes(mode)){
    assert(!await page.isVisible('#event-age-detail'));assert(!await page.isVisible('#event-age-min-month'));
   }
   const before=await page.evaluate(()=>testRows.length);
   await page.click('[data-next]');
   if(mode==='import'){await page.fill('#event-audience-evidence','親子活動');await page.check('#event-confirm-availability');
    // Imported activities still need a booking status, independent of age.
    await page.click('[data-back]');await page.selectOption('#event-booking','walkin');await page.click('[data-next]');}
   await page.click('[data-submit]');await page.waitForFunction(before=>testRows.length===before+1,before);
   const row=await page.evaluate(()=>testRows.at(-1));assert.equal(row.status,'pending');
   if(mode==='3-4'){assert.equal(row.age_min,3);assert.equal(row.age_max,4);assert.equal(row.age_detail,'3–4 歲');assert.equal(row.age_min_month,null)}
   if(mode==='0-12'||mode==='import'){assert.equal(row.age_min,0);assert.equal(row.age_max,12);assert.equal(row.age_detail,'各年齡')}
   if(mode==='custom'){assert.equal(row.age_min,2);assert.equal(row.age_max,5);assert.equal(row.age_detail,'2–5 歲')}
   if(mode==='months'){assert.equal(row.age_min_month,6);assert.equal(row.age_max_month,18);assert.equal(row.age_detail,null)}
   if(mode==='official')assert.equal(row.age_detail,'小一至小三');
   await page.evaluate(()=>E.openDraft(testRows.at(-1)));await page.click('[data-next]');
   assert.equal(await page.inputValue('#event-age-preset'),mode==='import'?'0-12':mode);
  }
  // Preserve legacy draft text and month fields when migrating to one age mode.
  await page.evaluate(()=>E.openDraft(null,{id:crypto.randomUUID(),fields:[{id:'event-age-preset',type:'select-one',value:'3-4'},{id:'event-age-detail',type:'text',value:'小一至小三'}]}));
  assert.equal(await page.inputValue('#event-age-preset'),'official');
  await page.evaluate(()=>{activeDraft=null;document.querySelector('#md').classList.remove('s');
   const uid=AUTH.u.id;
   testRows=['approved','pending','rejected'].map((status,i)=>({id:'e'+i,author_id:uid,title:'活動-'+status,status,reject_reason:status==='rejected'?'請補活動資料':null,start_at:'2026-11-13T01:00:00Z',end_at:'2026-11-13T02:00:00Z',city:'台北市',listing_type:'event'}));
   testRows.push({...testRows[0],id:'other',author_id:'other-user',title:'別人的投稿'});
   testGames=['approved','pending','rejected'].map((status,i)=>({id:'g'+i,author_id:uid,title:'遊戲-'+status,status,age:1}));
   E.reset();G.reset();ACC.tab='posts';
  });
  await page.evaluate(()=>accountPage());
  for(const [status,title] of [['approved','已核准'],['pending','待審核'],['rejected','已退回']]){
   const section=page.locator(`details[data-k="posts-${status}"]`);
   assert.match(await section.locator('summary').innerText(),new RegExp(title+'（2）'));
   assert.match(await section.innerText(),new RegExp('活動-'+status));assert.match(await section.innerText(),new RegExp('遊戲-'+status));
   assert.equal(await section.locator('[data-a$=".edit"]').count(),2);
  }
  assert.match(await page.locator('details[data-k="posts-rejected"]').innerText(),/請補活動資料/);
  assert(!await page.getByText('別人的投稿',{exact:true}).count());
  await page.screenshot({path:'/tmp/account-posts-'+width+'.png',fullPage:true});
  await page.evaluate(async()=>{AUTH.me.account_type='organization';await accountPage()});
  assert.match(await page.locator('details[data-k="posts-approved"] summary').innerText(),/已核准（1）/);
  assert(!await page.getByText('遊戲-approved',{exact:true}).count());
  await page.evaluate(async()=>{AUTH.me.account_type='personal';ACC.tab='favs';await accountPage()});
  assert.equal(await page.locator('details[data-k="fg"]').count(),1);assert.equal(await page.locator('details[data-k="posts-approved"]').count(),0);
  await page.evaluate(async()=>{testRows=[];testGames=[];E.reset();G.reset();ACC.tab='posts';await accountPage()});
  assert.match(await page.locator('details[data-k="posts-approved"] summary').innerText(),/已核准（0）/);
  assert.match(await page.locator('details[data-k="posts-pending"] summary').innerText(),/待審核（0）/);
  assert.equal(await page.locator('details[data-k="posts-rejected"]').count(),0);
  assert.deepEqual(errors,[]);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  console.log('PASS:',width,'px; unified preset/custom/month/text ages, shared and imported submissions, stale-value isolation, restoration, status groups/counts/ownership, rejected reasons, organization and favorites');
  await page.close();
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
