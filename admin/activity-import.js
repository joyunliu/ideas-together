import {mountImportEventOptions} from "./import-event-options.js";
import {prepareDiscovery} from "./official-discovery.js";
import {importKey,inspectEvent} from "./ai-event-import-preview.js";

const escape = value => String(value??"").replace(/[&<>"']/g, ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const localDateTime = value => {
  const time=Date.parse(value);
  return Number.isFinite(time)?new Date(time+8*3600000).toISOString().slice(0,16):"";
};
const editable = [
  ["title","活動名稱","text",50],["start_at","開始（臺灣時間）","datetime-local"],
  ["end_at","結束（臺灣時間）","datetime-local"],["city","縣市","city"],
  ["venue","地點","text",60],["fee","費用（元）","number",100000],
  ["age_min","最小年齡","number",12],["age_max","最大年齡","number",12],
  ["shared_organizer","主辦單位","text",100],["link","活動來源網址","url",200],
  ["description","活動介紹","textarea",800],
];
const eventFields = new Set([...editable.map(([key])=>key),
  "district","address","fee_note","photo","map_link","audience","flex_time","dates","continuous","schedule",
  "series_booking","recurrence_note","age_detail","age_min_month","age_max_month","booking_status","listing_type",
  "visit_note","fee_type","fee_max"]);
const draftKey = item => [item.link,item.title,item.start_at].join("|");

export function mountActivityImport(root,{sb,userId,cities,canManage,onSubmitted}){
  const $=selector=>root.querySelector(selector);
  const permitted=()=>root.isConnected&&canManage();
  let drafts=[], source=null, current="search", searching=false, searchError="", draftError="";
  const optionCities=cities.map(city=>`<option>${escape(city)}</option>`).join("");
  root.innerHTML=`<h3>搜尋或匯入活動</h3>
    <div class="r" aria-label="匯入方式">
      <button type="button" data-import-view="search">搜活動</button>
      <button type="button" data-import-view="drafts">雲端草稿</button>
      <button type="button" data-import-view="link">貼上網址</button>
    </div>
    <p class="mu" id="activity-status" role="status"></p>
    <div id="activity-search">
      <div class="r"><label>地區<select id="activity-region"><option>全台</option>${optionCities}</select></label>
        <label>類型<select id="activity-category"><option>全部活動</option><option>親子活動</option><option>圖書館活動</option><option>展覽</option></select></label>
      </div>
      <div class="r"><button type="button" id="activity-refresh">重新搜尋</button><span class="mu" id="activity-count" role="status"></span></div>
      <div id="activity-results"></div>
    </div>
    <div id="activity-drafts" hidden><p class="mu">讀取雲端草稿中…</p></div>
    <div id="activity-link" hidden></div>
    <div id="activity-editor" hidden></div>`;
  const status=message=>{$("#activity-status").textContent=message};
  const tabs=[...root.querySelectorAll("[data-import-view]")];
  function show(view){
    current=view;
    for(const tab of tabs){
      const selected=tab.dataset.importView===view;
      tab.classList.toggle("on",selected);
      tab.setAttribute("aria-pressed",String(selected));
    }
    for(const section of ["search","drafts","link","editor"])$("#activity-"+section).hidden=section!==view;
    if(view!=="editor")$("#activity-editor").replaceChildren();
  }
  function renderDrafts(){
    const list=$("#activity-drafts");
    list.innerHTML=draftError?`<p class="mu">${escape(draftError)}</p><button type="button" data-reload-drafts>重新讀取草稿</button>`:
      drafts.map(record=>`<div class="cm"><b>${escape(record.title||"未命名活動")}</b>
        <div class="mu">${escape([record.payload?.city,localDateTime(record.payload?.start_at).replace("T"," ")].filter(Boolean).join(" · "))}</div>
        <div class="r"><button type="button" data-edit="${escape(record.id)}">編輯</button><button type="button" class="d" data-remove="${escape(record.id)}">刪除草稿</button></div></div>`).join("")||'<p class="mu">尚無雲端草稿。</p>';
  }
  async function loadDrafts(){
    const {data,error}=await sb.from("official_event_drafts").select("id,title,payload").order("updated_at",{ascending:false}).limit(500);
    if(!permitted())return;
    draftError=error?"讀取雲端草稿失敗："+error.message:"";
    if(!error)drafts=data||[];
    renderDrafts();
  }
  function renderResults(){
    const found=prepareDiscovery(source?.rows,$("#activity-region").value,$("#activity-category").value);
    const count=$("#activity-count");
    const live={partial:"文化部部分來源",snapshot:"文化部備份資料",unavailable:"文化部未取得"}[source?.national_source];
    count.textContent=searching?"搜尋未來三個月的活動…":searchError||`找到 ${found.length} 筆${live?" · "+live:""}`;
    const list=$("#activity-results");
    list.innerHTML=found.map(({candidate,source:row},index)=>`<div class="cm">
      <b>${escape(candidate.title)}</b>
      <div class="mu">${escape([candidate.city,candidate.start_at.slice(0,10)+(row.last_day&&row.last_day!==candidate.start_at.slice(0,10)?" ～ "+row.last_day:""),candidate.venue].filter(Boolean).join(" · "))}</div>
      <div class="r"><button type="button" data-result="${index}">編輯並匯入</button>
      <a href="${escape(candidate.link)}" target="_blank" rel="noopener noreferrer">原始公告 ↗</a></div></div>`).join("")||
      (!searching&&!searchError?'<p class="mu">這個篩選目前沒有符合的活動。</p>':"");
    list.onclick=event=>{
      const button=event.target.closest("[data-result]");
      if(!button||!permitted())return;
      const item=found[Number(button.dataset.result)].candidate;
      const saved=drafts.find(draft=>draftKey(draft.payload||{})===draftKey(item));
      openEditor(saved?.payload||item,saved?.id);
    };
  }
  async function search(){
    if(searching||!permitted())return;
    searching=true;searchError="";
    $("#activity-refresh").disabled=true;
    renderResults();
    try{
      const {data,error}=await sb.functions.invoke("refresh-web-candidates",{body:{}});
      if(error||!Array.isArray(data?.rows))throw error||Error("沒有收到活動資料");
      source=data;
    }catch{
      searchError=source?"重新搜尋失敗，仍顯示上次結果。":"搜尋失敗，請重新搜尋。";
    }finally{
      searching=false;
      if(permitted()){
        $("#activity-refresh").disabled=false;
        renderResults();
      }
    }
  }
  function field(item,[key,label,type,limit]){
    const name=`name="${key}"`;
    const value=item[key]??"";
    if(type==="city")return `<label>${label}<select ${name}>
      <option value="">選擇縣市</option>${[...new Set([...cities,...(value?[value]:[])])].map(city=>`<option ${city===value?"selected":""}>${escape(city)}</option>`).join("")}</select></label>`;
    if(type==="textarea")return `<label>${label}<textarea ${name} rows="4" maxlength="${limit}">${escape(value)}</textarea></label>`;
    const attrs=type==="number"?`min="0" max="${limit}" step="1"`:limit?`maxlength="${limit}"`:"";
    return `<label>${label}<input ${name} type="${type}" ${attrs} value="${escape(type==="datetime-local"?localDateTime(value):value)}"></label>`;
  }
  function openEditor(item,id){
    const back=current;
    show("editor");
    status("");
    const fields=Object.fromEntries(editable.map(binding=>[binding[0],field(item,binding)]));
    $("#activity-editor").innerHTML=`<form>
      <button type="button" data-editor-back>返回${back==="drafts"?"草稿":"搜尋結果"}</button>
      <h4>編輯活動</h4>
      ${fields.title}<div class="r">${fields.start_at}${fields.end_at}</div>
      <div class="r">${fields.city}${fields.venue}</div><div class="r">${fields.fee}${fields.age_min}${fields.age_max}</div>
      ${fields.shared_organizer}${fields.link}
      ${/^https?:\/\//i.test(item.link||"")?`<a href="${escape(item.link)}" target="_blank" rel="noopener noreferrer">開啟原始公告 ↗</a>`:""}
      ${fields.description}
      <label class="kopt"><input type="checkbox" name="verified">已核對活動來源、場次及報名狀態</label>
      <p class="mu" data-editor-status role="status"></p>
      <div class="r"><button type="submit" class="p">送審</button><button type="button" data-save-draft>儲存草稿</button></div>
    </form>`;
    const form=$("#activity-editor form");
    const collectOptions=mountImportEventOptions(form,item);
    form.scrollIntoView({block:"start"});
    const message=text=>{form.querySelector("[data-editor-status]").textContent=text};
    const collect=()=>{
      const candidate={...item};
      for(const [key,,type] of editable){
        const value=form.elements.namedItem(key).value.trim();
        candidate[key]=type==="number"?(value===""?undefined:Number(value)):
          type==="datetime-local"?(value?value+":00+08:00":undefined):value;
      }
      return collectOptions(candidate);
    };
    const save=async candidate=>{
      const values={title:candidate.title,payload:candidate,source_url:candidate.link||null,updated_at:new Date().toISOString()};
      const query=id?sb.from("official_event_drafts").update(values).eq("id",id):
        sb.from("official_event_drafts").insert({...values,created_by:userId});
      const {error}=await query.select("id").single();
      if(error)throw error;
    };
    async function run(send){
      if(!permitted())return;
      const controls=[...form.querySelectorAll("button")];
      if(controls.some(button=>button.disabled))return;
      let candidate;
      try{candidate=collect()}catch(error){message(error.message);return;}
      for(const button of controls)button.disabled=true;
      for(const tab of tabs)tab.disabled=true;
      message(send?"檢查並送審中…":"儲存中…");
      try{
        if(send){
          candidate.source_verified=form.elements.verified.checked;
          const checked=inspectEvent(candidate);
          if(checked.state!=="ready")throw Error([...checked.errors,...checked.warnings].join("；"));
          const key=await importKey(candidate);
          const {data:prior,error:priorError}=await sb.from("events").select("id").eq("ai_import_key",key).eq("author_id",userId).maybeSingle();
          if(priorError)throw priorError;
          if(!prior){
            const citiesToCheck=[...new Set([candidate.city,candidate.city.replace(/^台/,"臺"),candidate.city.replace(/^臺/,"台")])];
            let duplicates=[];
            for(let offset=0;;offset+=500){
              const {data,error}=await sb.from("events").select("id,title,link,city,venue,shared_organizer,start_at,continuous")
                .in("city",citiesToCheck).order("id").range(offset,offset+499);
              if(error)throw error;
              duplicates=inspectEvent(candidate,data).duplicates;
              if(duplicates.length||data.length<500)break;
            }
            if(duplicates.length)throw Error("疑似重複活動，請到後台核對："+duplicates[0].title);
            const payload=Object.fromEntries(Object.entries(candidate).filter(([key])=>eventFields.has(key)));
            const {error}=await sb.from("events").insert({...payload,author_id:userId,status:"pending",ai_import_key:key});
            if(error)throw error;
          }
          const cleanup=id?await sb.from("official_event_drafts").delete().eq("id",id):null;
          if(permitted()){
            onSubmitted();
            show(back);
            status(cleanup?.error?"活動已送審，雲端草稿仍保留。":"活動已送審，尚未公開。");
          }
        }else{
          await save(candidate);
          if(permitted()){
            show("drafts");
            status("已儲存雲端草稿。");
          }
        }
        if(permitted())await loadDrafts();
      }catch(error){
        if(permitted())message((send?"無法送審：":"無法儲存：")+error.message);
      }finally{
        for(const button of [...controls,...tabs])button.disabled=false;
      }
    }
    form.querySelector("[data-editor-back]").onclick=()=>show(back);
    form.querySelector("[data-save-draft]").onclick=()=>run(false);
    form.onsubmit=event=>{event.preventDefault();run(true)};
  }
  for(const tab of tabs)tab.onclick=()=>{
    show(tab.dataset.importView);
    status("");
    if(current==="drafts")loadDrafts();
  };
  $("#activity-refresh").onclick=search;
  $("#activity-region").onchange=$("#activity-category").onchange=renderResults;
  $("#activity-drafts").onclick=async event=>{
    if(!permitted())return;
    if(event.target.closest("[data-reload-drafts]"))return loadDrafts();
    const button=event.target.closest("[data-edit],[data-remove]");
    const record=button&&drafts.find(row=>row.id===(button.dataset.edit||button.dataset.remove));
    if(!record)return;
    if(button.dataset.edit)return openEditor(record.payload||{},record.id);
    if(!confirm("確定刪除這份雲端草稿？"))return;
    button.disabled=true;
    const {error}=await sb.from("official_event_drafts").delete().eq("id",record.id);
    if(!permitted())return;
    if(error){status("刪除失敗："+error.message);button.disabled=false;return}
    await loadDrafts();
  };
  show("search");
  loadDrafts();
  search();
}
