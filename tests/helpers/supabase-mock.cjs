// Isolated in-memory backend for browser tests. Never contacts Supabase.
module.exports=`window.testRows=[];window.testGames=[];window.testWrites=[];window.supabase={createClient:()=>({
 auth:{onAuthStateChange(){}},rpc:async(name,args)=>{
  if(name==='submit_verified_event_import'){
   const row={id:crypto.randomUUID(),author_id:AUTH.u.id,...args.p_event};window.testRows.push(row);window.testWrites.push({op:'import',row:structuredClone(row)});return {data:row.id};
  }
  return {data:[]};
 },
 storage:{from:()=>({remove:async()=>({}),getPublicUrl:()=>({data:{publicUrl:''}})})},
 from(table){let op='select',value,filters=[],single=false,done=false,result;
 const query=new Proxy({}, {get(_,name){
  if(name==='then')return (resolve,reject)=>Promise.resolve().then(()=>{
   if(done)return result;done=true;
   let rows=table==='events'?window.testRows:table==='games'?window.testGames:[];
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
