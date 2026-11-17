const {chromium}=require('playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8'),mock=require('./helpers/supabase-mock.cjs');
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 try{
 const page=await browser.newPage();
 await page.route('**/*',async r=>{
  const url=r.request().url();
  if(url.includes('supabase.min.js'))return r.fulfill({contentType:'text/javascript',body:mock});
  if(url.startsWith('https://app.test/'))return r.fulfill({contentType:'text/html',body:html});
  return r.abort();
 });
 await page.goto('https://app.test/');
 await page.evaluate(async()=>{
  AUTH.u={id:'member'};AUTH.me={account_type:'personal',suspended:false};
  testGames=[4,5,6,7,8].map(age=>({id:'g'+age,author_id:'member',title:'遊戲'+age,how:'玩法',age,status:'approved',materials:[],tags:[],photos:[],created_at:'2026-11-17'}));
  G.reset();await G.show();
 });
 const filters=page.locator('[data-a="g.chip"][data-k="age"]');
 assert.deepEqual(await filters.allTextContents(),['不限年齡','0 歲以上','1 歲以上','2 歲以上','3 歲以上','4 歲以上','6 歲以上','8 歲以上','10 歲以上']);
 await page.locator('[data-k="age"][data-v="5"]').click();
 assert.equal(await page.locator('article.c').count(),2);
 await page.evaluate(()=>G.openDraft(G.S.games.find(g=>g.age===6)));
 assert.equal(await page.locator('#game-fa option:checked').innerText(),'6 歲以上');
 assert.equal(await page.locator('#game-fa option:not([hidden])').count(),8);
 await page.evaluate(()=>G.openDraft(null,{id:'legacy',fields:[{id:'game-fa',type:'select-one',value:'6'}]}));
 assert.equal(await page.inputValue('#game-fa'),'6');
 assert.equal(await page.locator('#game-fa option:checked').innerText(),'6 歲以上');
 console.log('PASS: minimum-age filters, legacy six-year categories, edit selection and stored draft restoration');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
