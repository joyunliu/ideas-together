const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const fs=require('fs'),assert=require('assert/strict'),vm=require('vm');
(async()=>{
 const html=fs.readFileSync('index.html','utf8'),data=fs.readFileSync('assets/parenting-resources.js','utf8');
 const ctx={window:{}};vm.runInNewContext(data,ctx);const resources=ctx.window.PARENTING_RESOURCES;
 assert.equal(resources.length,12);assert.equal(new Set(resources.map(r=>r.url)).size,12);
 assert.equal(resources.filter(r=>r.name.includes('新北育兒')).length,1);
 const code=html.slice(html.indexOf('function parentingResourceRows('),html.indexOf('const resourceFilters='));
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:900}});
  await page.setContent('<style>'+html.match(/<style>([\s\S]*?)<\/style>/)[1]+'</style><main id="app"><div id="resource-browse"></div></main>');
  await page.evaluate(({code,resources})=>{
   window.$=s=>document.querySelector(s);window.esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
   window.eval(code);parentingResourceBrowse([]);
  },{code,resources});
  assert.equal(await page.locator('article').count(),0);
  await page.evaluate(resources=>parentingResourceBrowse(resources.filter(r=>r.verified)),resources);
  assert.equal(await page.locator('article').count(),resources.filter(r=>r.verified).length);
  assert(await page.locator('article h3').evaluateAll(titles=>!titles.some(t=>t.textContent==='臺中市育兒資源網')));
  // Verified fixtures exercise the UI without publishing unverified destinations.
  await page.evaluate(resources=>parentingResourceBrowse(resources.map(r=>({...r,verified:true}))),resources);
  assert.equal(await page.locator('article').count(),12);
  await page.selectOption('#parenting-city','臺北市');assert.equal(await page.locator('article').count(),3);
  await page.selectOption('#parenting-city','高雄市');assert.equal(await page.locator('article').count(),3);
  await page.selectOption('#parenting-city','新竹市');assert.equal(await page.locator('article').count(),2);
  await page.selectOption('#parenting-city','');assert.equal(await page.locator('article').count(),12);
  assert(await page.locator('article a').evaluateAll(links=>links.every(a=>a.target==='_blank'&&a.rel.includes('noopener')&&a.textContent==='查看網站')));
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert(await page.locator('article a').first().evaluate(a=>a.getBoundingClientRect().height>=44));
  await page.screenshot({path:'/tmp/parenting-'+width+'.png',fullPage:true});
  console.log('PASS:',width,'px; empty state, 12 fixture cards, city + national filtering, safe new tabs, no overflow, touch targets');
  await page.close();
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exitCode=1});
