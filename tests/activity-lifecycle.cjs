const {chromium}=require('playwright'),fs=require('fs'),assert=require('assert/strict');
(async()=>{
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
for(const width of [390,1280]){
 const page=await browser.newPage({viewport:{width,height:900}});
 await page.route('**/*',r=>r.request().url().includes('supabase.min.js')?r.fulfill({contentType:'text/javascript',body:require('./helpers/supabase-mock.cjs')}):r.request().url()==='https://app.test/'?r.fulfill({contentType:'text/html',body:fs.readFileSync('index.html','utf8')}):r.abort());
 await page.goto('https://app.test/');
 const result=await page.evaluate(()=>{
 const base={id:'x',title:'測試',status:'approved',city:'台北市',listing_type:'event',start_at:'2026-11-15T02:00:00Z',flex_time:false,profiles:{nickname:'測試'}};
 const now=Date.parse('2026-11-15T15:00:00Z');
 const checks=[!E.eventExpired(base,now),E.eventExpired(base,Date.parse('2026-11-16T00:00:00Z')), !E.eventExpired({...base,end_at:'2026-11-20T09:00:00Z'},now),!E.eventExpired({...base,schedule:[{d:'2026-11-14',e:'10:00'},{d:'2026-11-20',e:'10:00'}]},now),E.effectiveEnd({...base,flex_time:true})===null,E.effectiveEnd({...base,recurrence_note:'每週'})===null,!E.publiclyListed({...base,archived_at:'2026-11-15'})];
 AUTH.u={id:'admin'};AUTH.me={is_admin:true,suspended:false};E.S.ev=[base];document.querySelector('#app').innerHTML='<div id="activity-manager"></div>';renderActivityManager();activityState.tab='approved';renderActivityManager();document.querySelector('[data-inline]').click();
 checks.push(!document.querySelector('#md').classList.contains('s'),[...document.querySelectorAll('#inline-x .post-step')].every(x=>!x.hidden),document.querySelector('[data-submit]').textContent==='審核並發布');
 return checks;
 }); assert(result.every(Boolean),JSON.stringify(result));console.log('PASS lifecycle and inline manager at '+width+'px');await page.close();
}await browser.close();
})();
