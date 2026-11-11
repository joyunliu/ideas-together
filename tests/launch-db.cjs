const fs=require("node:fs"),assert=require("node:assert/strict");
const {PGlite}=require(process.env.PGLITE_PATH||"@electric-sql/pglite");
(async()=>{
const db=new PGlite();
await db.exec(`
create role anon;
create role authenticated;
create schema auth;
grant usage on schema auth to anon,authenticated;
create function auth.uid() returns uuid language sql stable
as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
create table auth.users(id uuid primary key,email varchar,created_at timestamptz default now());
create table profiles(id uuid primary key,nickname text,suspended boolean,is_admin boolean);
create function is_admin() returns boolean language sql stable as $$ select false $$;
create function is_suspended() returns boolean language sql stable as $$ select coalesce((select suspended from profiles where id=auth.uid()),false) $$;
create table events(id uuid default gen_random_uuid() primary key,author_id uuid,status text,title text,description text,
 start_at timestamptz,end_at timestamptz,city text,district text,venue text,address text,age_min integer,age_max integer,
 fee integer,fee_note text,link text,photo text,map_link text,audience text,flex_time boolean,dates date[],continuous boolean,
 schedule jsonb,shared_organizer text,series_booking boolean,recurrence_note text,age_detail text,age_min_month smallint,
 age_max_month smallint,booking_status text,booking_checked_at timestamptz,listing_type text,visit_note text,related_exhibition_id uuid);
create table games(id uuid primary key,author_id uuid,status text);
create table reports(id uuid default gen_random_uuid(),user_id uuid,game_id uuid,comment_id uuid,target_user_id uuid,event_id uuid,reason text);
alter table reports enable row level security;
create policy "reports add" on reports for insert to authenticated with check (true);
create policy "reports admin del" on reports for delete to authenticated using (is_admin());
create policy "reports admin read" on reports for select to authenticated using (is_admin());
create table event_import_suggestions(event_id uuid,source_name text,source_url text,source_key text,audience_evidence text);
create table event_registrations(event_id uuid);
create table content_view_events(content_id uuid,content_type text);
create table likes(user_id uuid,game_id uuid);
create table favs(user_id uuid,game_id uuid);
create table played(user_id uuid,game_id uuid);
create table event_likes(user_id uuid,event_id uuid);
create table event_favs(user_id uuid,event_id uuid);
grant select,insert,update,delete on all tables in schema public to anon,authenticated;
`);
for(const table of ["likes","favs","played","event_likes","event_favs"])
await db.exec(`alter table ${table} enable row level security; create policy "${table} read" on ${table} for select using (true)`);
const uid=i=>"00000000-0000-0000-0000-00000000000"+i;
const [admin,member,suspended,event,hidden,report]=[1,2,3,4,5,6].map(uid);
const as=(role,user="")=>db.exec(`reset role; select set_config('test.uid','${user}',false); set role ${role}`);
for(const name of ["launch-review","launch-reactions-privacy"])
 await db.exec(fs.readFileSync("supabase/"+name+".sql","utf8"));
await db.exec(`
insert into auth.users(id,email) values ('${admin}','admin@example.invalid'),('${member}','member@example.invalid'),('${suspended}','suspended@example.invalid');
insert into profiles values ('${admin}','Admin',false,true),('${member}','Member',false,false),('${suspended}','Suspended',true,true);
insert into events(id,author_id,status,title,fee,start_at) values ('${event}','${member}','approved','Public',0,now()-interval '40 days'),('${hidden}','${member}','pending','Private',500,now());
insert into event_favs values ('${member}','${event}'),('${admin}','${event}'),('${member}','${hidden}');
`);
await assert.rejects(db.query("insert into events(fee,fee_type,fee_max) values (350,'range',300)"),/launch_event_fee_shape/);
await assert.rejects(db.query("insert into events(fee,fee_type) values (500,'free')"),/launch_event_fee_shape/);
const cleanup=await db.query(fs.readFileSync("supabase/launch-cleanup-preview.sql","utf8"));
assert.equal(cleanup.rows[0].id,event);
assert.equal(cleanup.rows[0].has_related_data,true);
await as("anon");
assert.equal((await db.query("select * from event_favs")).rows.length,0);
assert.deepEqual((await db.query(`select content_id,favs::int from launch_reaction_counts('event',array['${event}','${hidden}']::uuid[])`)).rows,[{content_id:event,favs:2}]);
await assert.rejects(db.query("select * from launch_members()"),/permission denied/);
await as("authenticated",member);
assert.equal((await db.query("select * from event_favs")).rows.length,2);
await assert.rejects(db.query("select * from launch_members()"),/會員管理權限/);
await assert.rejects(db.query(`insert into reports(user_id,event_id,reason,category,review_status) values ('${member}','${event}','Test','date','resolved')`),/row-level security/);
await assert.rejects(db.query(`insert into reports(user_id,event_id,reason,category) values ('${member}','${hidden}','Test','date')`),/row-level security/);
await db.query(`insert into reports(id,user_id,event_id,reason,category) values ('${report}','${member}','${event}','Test','date')`);
assert.equal((await db.query("select * from reports")).rows.length,0);
await assert.rejects(db.query(`select launch_review_report('${report}','resolved')`),/無法處理/);
await as("authenticated",suspended);
assert.equal((await db.query("select is_admin()")).rows[0].is_admin,false);
await assert.rejects(db.query("select * from launch_members()"),/會員管理權限/);
await as("authenticated",admin);
assert.equal((await db.query("select count(*)::int as n from launch_members()")).rows[0].n,3);
await db.query(`select launch_review_report('${report}','resolved')`);
assert.equal((await db.query("select review_status,reviewed_by from reports")).rows[0].reviewed_by,admin);
assert.equal((await db.query("select review_status from reports")).rows[0].review_status,"resolved");
await assert.rejects(db.query(`select launch_review_report('${report}','dismissed')`),/回報已處理/);
const p={title:"親子測試",fee:350,fee_type:"range",fee_max:500};
const imported=await db.query("select submit_verified_event_import($1::jsonb,$2,null,$3) as id",[JSON.stringify(p),"https://example.invalid/test","親子活動"]);
assert.equal((await db.query("select fee_max from events where id=$1",[imported.rows[0].id])).rows[0].fee_max,500);
await as("postgres");
await db.exec(fs.readFileSync("supabase/optional-import-end-time.sql","utf8"));
await db.exec(`
create temporary table import_time_test(changes jsonb default '{}', base_record jsonb, audience_evidence text default '親子活動');
create trigger check_import_time before insert on import_time_test
  for each row execute function public.validate_new_import_suggestion();
`);
const insertTime=timing=>db.query("insert into import_time_test(base_record) values ($1::jsonb)",[JSON.stringify({
  title:"親子活動",description:"親子共玩",shared_organizer:"主辦單位",city:"線上活動",
  start_at:"2026-12-01T09:00:00+08:00",flex_time:false,booking_status:"walkin",
  audience:"family",age_min:3,age_max:6,link:"https://example.invalid/event",...timing
})]);
await insertTime({end_at:null});
await insertTime({schedule:[{d:"2026-12-01",s:"09:00",e:null}]});
await assert.rejects(insertTime({continuous:true,end_at:null}),/跨日連續/);
await assert.rejects(insertTime({end_at:"2026-12-01T08:00:00+08:00"}),/結束時間需晚於/);
await assert.rejects(insertTime({schedule:[{d:"2026-12-01",s:"09:00",e:"08:00"}]}),/每場活動的日期與時間/);
console.log("PASS: imported events accept optional end times and reject invalid or missing required end times");
// Mirror the production event policies relevant to submitting and reviewing.
await db.exec(`
reset role;
alter table events add column reject_reason text;
alter table events enable row level security;
create policy "events read" on events for select using (
  author_id=auth.uid() or is_admin() or
  (status='approved' and not exists (select 1 from profiles p where p.id=events.author_id and p.suspended))
);
create policy "events insert" on events for insert to authenticated with check (
  author_id=auth.uid() and status='pending' and not is_suspended()
);
create policy "events admin update" on events for update to authenticated using (is_admin());
create policy "events author update" on events for update to authenticated
  using (author_id=auth.uid() and not is_suspended())
  with check (author_id=auth.uid() and status='pending' and not is_suspended());
`);
await as("authenticated",member);
const submit=async title=>(await db.query(
  "insert into events(author_id,status,title,fee) values (auth.uid(),'pending',$1,0) returning id",[title]
)).rows[0].id;
const approvedId=await submit("核准流程");
const rejectedId=await submit("退回流程");
const read=id=>db.query("select status,reject_reason from events where id=$1",[id]);
const review=(id,state,reason=null)=>db.query(
  "update events set status=$2,reject_reason=$3 where id=$1 and status='pending' returning id",[id,state,reason]
);
await assert.rejects(review(approvedId,"approved"),/row-level security/);
await as("anon");
assert.equal((await read(approvedId)).rows.length,0);
await as("authenticated",suspended);
assert.equal((await review(approvedId,"approved")).rows.length,0);
await as("authenticated",admin);
assert.equal((await review(approvedId,"approved")).rows.length,1);
assert.equal((await review(rejectedId,"rejected","請補場次")).rows.length,1);
assert.equal((await review(approvedId,"rejected","已處理")).rows.length,0);
await as("anon");
assert.equal((await read(approvedId)).rows[0].status,"approved");
assert.equal((await read(rejectedId)).rows.length,0);
await as("authenticated",member);
assert.deepEqual((await read(rejectedId)).rows[0],{status:"rejected",reject_reason:"請補場次"});
console.log("PASS: pending submission, public approval, private rejection reason and review permissions");
await db.exec("reset role; alter table events add constraint events_booking_status_check check (booking_status <> 'postponed')");
await db.exec(fs.readFileSync("supabase/launch-archive.sql","utf8"));
await db.exec(`
insert into events(author_id,status,title,fee,start_at,listing_type,booking_status,schedule) values
 ('${member}','approved','Postponed',0,now()-interval '40 days','event','postponed',null),
 ('${member}','approved','Recurring',0,now()-interval '40 days','resource',null,null),
 ('${member}','approved','Future session',0,now()-interval '40 days','event',null,
  jsonb_build_array(jsonb_build_object('d',(current_date+10)::text))),
 ('${member}','approved','Bad date',0,now()-interval '40 days','event',null,'[{"d":"2026-02-31"}]');
`);
assert.equal((await db.query("select launch_private.archive_expired() as count")).rows[0].count,1);
assert.equal((await db.query("select launch_private.archive_expired() as count")).rows[0].count,0);
assert.equal((await db.query("select count(*)::int as n from event_favs where event_id=$1",[event])).rows[0].n,2);
await as("anon");
assert.equal((await read(event)).rows.length,0);
await as("authenticated",member);
await assert.rejects(db.query("select launch_restore_event($1)",[event]),/沒有還原權限/);
await assert.rejects(db.query("update events set status='pending',archived_at=null where id=$1",[event]),/不能設定封存狀態/);
await as("authenticated",admin);
await db.query("select launch_restore_event($1)",[event]);
assert.deepEqual((await db.query("select action from launch_archive_history()")).rows.map(row=>row.action),["restore","archive"]);
await db.exec("reset role");
assert.equal((await db.query("select launch_private.archive_expired() as count")).rows[0].count,0);
assert.equal((await db.query("select archive_exempt from events where id=$1",[event])).rows[0].archive_exempt,true);
console.log("PASS: archive exclusions, preserved favorites, repeat execution, visibility and restore");
await db.close();
console.log("PASS: PostgreSQL migrations, fee checks, cleanup dependencies, reaction privacy, report permissions, membership and imported fee");
})().catch(e=>{console.error(e);process.exitCode=1});
