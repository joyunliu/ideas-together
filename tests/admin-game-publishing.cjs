const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const source=html.match(/const gameOrgRestricted=.*;/)[0];
const c=vm.createContext({});vm.runInContext(source,c);
for(const [profile,restricted] of [
 [{account_type:'organization',is_admin:true,suspended:false},false],
 [{account_type:'organization',is_admin:false,suspended:false},true],
 [{account_type:'organization',is_admin:true,suspended:true},true],
 [{account_type:'personal',is_admin:false,suspended:false},false],
 [{account_type:'organization',nickname:'點子共玩所',is_admin:false},true]
])assert.equal(vm.runInContext(`gameOrgRestricted(${JSON.stringify(profile)})`,c),restricted);
const orgBlock=html.match(/const orgBlock=.*;/)[0];
c.S={me:{account_type:'organization',is_admin:true,suspended:false}};
c.alert=()=>{};vm.runInContext(orgBlock,c);
assert.equal(vm.runInContext('orgBlock(true)',c),false);
assert.equal(vm.runInContext('orgBlock()',c),true); // Comment permission remains separate.
c.S.me.is_admin=false;assert.equal(vm.runInContext('orgBlock(true)',c),true);
console.log('PASS: administrator organization publishing, suspended and ordinary organization restrictions, nickname spoofing and unchanged comment permissions');
