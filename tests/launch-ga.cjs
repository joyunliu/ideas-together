const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const {stripTypeScriptTypes}=require("node:module");
const {generateKeyPairSync,verify}=require("node:crypto");

async function main(){
  const {privateKey,publicKey}=generateKeyPairSync("rsa",{modulusLength:2048});
  const env=new Map([
    ["SUPABASE_URL","https://database.example.invalid"],
    ["SUPABASE_ANON_KEY","test-public-key"],
    ["GA4_PROPERTY_ID","12345"],
    ["GA4_SERVICE_ACCOUNT_JSON",JSON.stringify({
      client_email:"test@example.invalid",
      private_key:privateKey.export({type:"pkcs8",format:"pem"})
    })]
  ]);
  let handler,allowed=false,suspended=false,googleCalls=0;
  const context=vm.createContext({
    Response,Request,URLSearchParams,TextEncoder,Uint8Array,AbortSignal,crypto,btoa,atob,
    Deno:{env,serve:fn=>{handler=fn}},
    async fetch(url,init){
      if(url.endsWith("/auth/v1/user")){
        assert.equal(init.headers.authorization,"Bearer test-user");
        return Response.json({id:"test-user-id"});
      }
      if(url.includes("/rest/v1/profiles?")){
        assert.equal(init.headers.authorization,"Bearer test-user");
        assert.equal(new URL(url).searchParams.get("id"),"eq.test-user-id");
        return Response.json([{is_admin:allowed,suspended}]);
      }
      googleCalls++;
      if(url.endsWith("/token")){
        const [header,claims,signature]=init.body.get("assertion").split(".");
        const payload=JSON.parse(Buffer.from(claims,"base64url"));
        assert.equal(payload.scope,"https://www.googleapis.com/auth/analytics.readonly");
        assert(verify("RSA-SHA256",Buffer.from(header+"."+claims),publicKey,Buffer.from(signature,"base64url")));
        return Response.json({access_token:"test-google-token",expires_in:3600});
      }
      assert.match(url,/properties\/12345:batchRunReports$/);
      assert.equal(init.headers.authorization,"Bearer test-google-token");
      const requests=JSON.parse(init.body).requests;
      assert.deepEqual(requests[0].dateRanges,[{startDate:"7daysAgo",endDate:"yesterday"}]);
      assert.equal(requests[1].dimensions[0].name,"sessionDefaultChannelGroup");
      assert.equal(requests[2].dimensions[0].name,"pageTitle");
      const row=(values,label)=>({metricValues:values.map(value=>({value})),dimensionValues:[{value:label}]});
      return Response.json({reports:[{rows:[row(["8","10","13"])]},
        {rows:[row(["5"],"Organic Search")]},{rows:[row(["7"],"活動")]}]});
    }
  });
  const source=fs.readFileSync("supabase/functions/launch-ga-report/index.ts","utf8");
  vm.runInContext(stripTypeScriptTypes(source),context);
  const call=token=>handler(new Request("https://database.example.invalid",{method:"POST",
    headers:token?{authorization:"Bearer test-user"}:{}}));
  assert.equal((await call(false)).status,403);
  assert.equal((await call(true)).status,403);
  assert.equal(googleCalls,0);
  allowed=true;
  suspended=true;
  assert.equal((await call(true)).status,403);
  assert.equal(googleCalls,0);
  suspended=false;
  const data=await (await call(true)).json();
  assert.deepEqual(data,{state:"ready",activeUsers:8,sessions:10,pageViews:13,
    channels:[{label:"Organic Search",count:5}],pages:[{label:"活動",count:7}]});
  assert.equal(googleCalls,2);
  env.delete("GA4_PROPERTY_ID");
  assert.deepEqual(await (await call(true)).json(),{state:"unconfigured"});
  console.log("PASS: GA4 administrator authorization, JWT signing, report request and report payload");
}
main().catch(error=>{console.error(error);process.exitCode=1});
