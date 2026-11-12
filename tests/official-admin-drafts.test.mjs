import test from "node:test";
import assert from "node:assert/strict";
import {readFile,mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
const html=await readFile(new URL("../admin/ai-import.html",import.meta.url),"utf8");
test("admin module JavaScript parses",async()=>{
 const match=html.match(/<script type="module">([\s\S]*?)<\/script>/);
 assert.ok(match,"module script missing");
 const dir=await mkdtemp(join(tmpdir(),"official-draft-"));
 try{
  const file=join(dir,"admin.mjs");await writeFile(file,match[1]);
  const result=spawnSync(process.execPath,["--check",file],{encoding:"utf8"});
  assert.equal(result.status,0,result.stderr);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test("cloud draft management is admin-only and not local browser storage",()=>{
 assert.match(html,/official_event_drafts/);
 assert.match(html,/created_by:admin/);
 assert.match(html,/loadImportDrafts\(\)/);
 assert.doesNotMatch(html,/localStorage/);
 assert.match(html,/帶入人工審核預覽/);
});
