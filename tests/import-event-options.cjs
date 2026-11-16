const {chromium}=require('playwright'),fs=require('fs'),assert=require('assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:900}});
  await page.route('**/*',r=>{
   const url=new URL(r.request().url());
   if(url.pathname.startsWith('/admin/'))return r.fulfill({contentType:'text/javascript',body:fs.readFileSync('.'+url.pathname,'utf8')});
   return r.fulfill({contentType:'text/html',body:`<div id="root"></div><script type="module">import {mountActivityImport} from '/admin/activity-import.js';window.saved=[];window.cloud=[];const sb={functions:{invoke:async()=>({data:{rows:[]}})},from(table){let op='select',values,id;const q={select(){return q},order(){return q},limit(){return Promise.resolve({data:cloud})},insert(v){op='insert';values=v;return q},update(v){op='update';values=v;return q},eq(k,v){id=v;return q},single(){const row={...values,id:id||'draft-1'};cloud=[row];saved.push(row);return Promise.resolve({data:row})}};return q}};mountActivityImport(document.querySelector('#root'),{sb,userId:'admin',cities:['台北市'],canManage:()=>true,onSubmitted(){}});window.ready=true;</script>`});
  });
  await page.goto('https://app.test/');await page.waitForFunction(()=>window.ready);
  await page.evaluate(()=>{cloud=[{id:'draft-1',title:'測試',payload:{title:'測試',start_at:'2027-01-01T02:00:00Z',city:'台北市',fee:100}}]});
  await page.click('[data-import-view=drafts]');await page.click('[data-edit]');
  await page.selectOption('[name=timing_mode]','sessions');
  for(const [d,s,e] of [['2027-01-01','10:00','11:00'],['2027-02-01','14:00','16:00']]){
   await page.click('[data-add-session]');const row=page.locator('[data-slot]').last();await row.locator('[data-part=d]').fill(d);await row.locator('[data-part=s]').fill(s);await row.locator('[data-part=e]').fill(e);
  }
  await page.selectOption('[name=fee_type]','range');await page.fill('[name=fee]','100');await page.fill('[name=fee_max]','300');await page.fill('[name=fee_note]','兒童100元、成人300元');await page.click('[data-save-draft]');
  let payload=await page.evaluate(()=>saved.at(-1).payload);assert.equal(payload.schedule.length,2);assert.equal(payload.end_at,'2027-02-01T08:00:00.000Z');assert.equal(payload.fee_max,300);assert.equal(payload.fee_type,'range');
  await page.click('[data-edit]');assert.equal(await page.locator('[data-slot]').count(),2);assert.equal(await page.inputValue('[name=fee_note]'),'兒童100元、成人300元');
  await page.selectOption('[name=listing_type]','exhibition');await page.fill('[name=start_at]','2027-01-01T10:00');await page.fill('[name=end_at]','2027-02-28T17:00');await page.click('[data-save-draft]');payload=await page.evaluate(()=>saved.at(-1).payload);assert.equal(payload.listing_type,'exhibition');assert.equal(payload.schedule,null);assert.equal(payload.dates,null);
  await page.click('[data-edit]');await page.selectOption('[name=listing_type]','resource');await page.fill('[name=end_at]','');await page.fill('[name=recurrence_note]','每週六開放');await page.check('[name=flex_time]');await page.click('[data-save-draft]');payload=await page.evaluate(()=>saved.at(-1).payload);assert.equal(payload.end_at,undefined);assert.equal(payload.flex_time,true);assert.equal(payload.recurrence_note,'每週六開放');
  console.log('PASS '+width+'px import editor: sessions, price range, cloud round trip, exhibition, recurring');await page.close();
 }
 await browser.close();
})();
