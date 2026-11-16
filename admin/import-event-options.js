// The import editor uses the same events fields as the main activity editor.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const local=value=>Number.isFinite(Date.parse(value))?new Date(Date.parse(value)+28800000).toISOString().slice(0,16):'';
export function mountImportEventOptions(form,item){
 const select=(name,label,choices,value)=>`<label>${label}<select name="${name}">${Object.entries(choices).map(([v,l])=>`<option value="${v}" ${v===value?'selected':''}>${l}</option>`).join('')}</select></label>`;
 const mode=item.schedule?.length||item.dates?.length>1&&!item.continuous&&item.listing_type!=='exhibition'?'sessions':item.listing_type==='resource'||item.flex_time||item.recurrence_note&&!item.end_at?'recurring':item.continuous||local(item.start_at).slice(0,10)!==local(item.end_at||item.start_at).slice(0,10)?'range':'single';
 const feeType=item.fee_type||(item.fee===0?'free':item.fee!=null?'fixed':'');
 const host=document.createElement('div');host.innerHTML=`<div class="r">${select('listing_type','活動分類',{event:'活動',exhibition:'展覽',resource:'常態活動／資源'},item.listing_type||'event')}${select('timing_mode','日期與場次',{single:'單日活動',range:'跨日／展期',sessions:'多場次（每場獨立時間）',recurring:'常態／預約活動'},mode)}</div>
 <div data-sessions hidden><h4>活動場次</h4><div data-session-rows></div><button type="button" data-add-session>新增場次</button></div>
 <div data-recurring hidden><label>常態活動說明<input name="recurrence_note" maxlength="40" value="${esc(item.recurrence_note)}" placeholder="例如：每週六，實際場次依公告"></label><label><input type="checkbox" name="flex_time" ${item.flex_time?'checked':''}>可自行預約時間</label><p class="mu">沒有明確結束日期的常態活動不會直接判定過期；有確定場次時請選多場次。</p></div>
 <label data-continuous><input type="checkbox" name="continuous" ${item.continuous?'checked':''}>跨日連續進行（例如住宿營隊）</label>
 <label><input type="checkbox" name="series_booking" ${item.series_booking?'checked':''}>多場次需整套報名</label>
 <div class="r">${select('fee_type','票價方式',{'':'費用待確認',free:'免費',fixed:'單一票價',range:'多種票價／價格範圍',announcement:'依主辦公告'},feeType)}<label data-fee-max>最高票價（元）<input name="fee_max" type="number" min="0" max="100000" step="1" value="${esc(item.fee_max)}"></label></div>
 <label>票價說明<input name="fee_note" maxlength="60" value="${esc(item.fee_note)}" placeholder="例如：成人 300 元、兒童 150 元，請依公告填寫"></label>
 <label>開放／參觀說明<textarea name="visit_note" maxlength="240">${esc(item.visit_note)}</textarea></label>`;
 form.querySelector('[name=start_at]').closest('.r').before(host);
 const $=name=>form.elements.namedItem(name);
 let slots=Array.isArray(item.schedule)?item.schedule.map(x=>({...x})):item.dates?.length?item.dates.map(d=>({d,s:local(item.start_at).slice(11),e:local(item.end_at).slice(11)})):[];
 const rows=host.querySelector('[data-session-rows]');
 function draw(){rows.innerHTML=slots.map((x,i)=>`<div class="r" data-slot="${i}"><label>日期<input type="date" data-part="d" value="${esc(x.d)}"></label><label>開始<input type="time" data-part="s" value="${esc(x.s)}"></label><label>結束（選填）<input type="time" data-part="e" value="${esc(x.e)}"></label><button type="button" data-remove-slot="${i}">移除場次</button></div>`).join('');}
 rows.oninput=event=>{const row=event.target.closest('[data-slot]');if(row&&event.target.dataset.part)slots[Number(row.dataset.slot)][event.target.dataset.part]=event.target.value};
 rows.onclick=event=>{const button=event.target.closest('[data-remove-slot]');if(button){slots.splice(Number(button.dataset.removeSlot),1);draw()}};
 host.querySelector('[data-add-session]').onclick=()=>{slots.push({d:'',s:'',e:''});draw()};
 const dates=form.querySelector('[name=start_at]').closest('.r');
 function update(){
  const m=$('timing_mode').value,t=$('listing_type').value,f=$('fee_type').value;
  dates.hidden=m==='sessions';host.querySelector('[data-sessions]').hidden=m!=='sessions';
  host.querySelector('[data-recurring]').hidden=m!=='recurring';host.querySelector('[data-continuous]').hidden=m!=='range'||t==='exhibition';
  host.querySelector('[data-fee-max]').hidden=f!=='range';
  $('fee').closest('label').hidden=!['fixed','range'].includes(f);
  $('fee').closest('label').firstChild.textContent=f==='range'?'最低票價（元）':'費用（元）';
 }
 $('timing_mode').onchange=update;$('listing_type').onchange=()=>{if($('listing_type').value==='exhibition')$('timing_mode').value='range';if($('listing_type').value==='resource')$('timing_mode').value='recurring';update()};$('fee_type').onchange=update;draw();update();
 return candidate=>{
  const m=$('timing_mode').value,f=$('fee_type').value;
  candidate.listing_type=$('listing_type').value;candidate.fee_type=f||null;
  candidate.fee_max=f==='range'&&$('fee_max').value!==''?Number($('fee_max').value):null;
  candidate.fee_note=$('fee_note').value.trim()||null;candidate.visit_note=$('visit_note').value.trim()||null;
  if(['free','announcement'].includes(f))candidate.fee=0;
  if(!f)candidate.fee=undefined;
  if(f==='range'&&candidate.fee_max!==null&&candidate.fee_max<candidate.fee)throw Error('最高票價不可低於最低票價');
  candidate.series_booking=$('series_booking').checked;
  candidate.flex_time=m==='recurring'&&$('flex_time').checked;
  candidate.recurrence_note=m==='recurring'?$('recurrence_note').value.trim()||null:null;
  candidate.continuous=m==='range'&&candidate.listing_type!=='exhibition'&&$('continuous').checked;
  candidate.schedule=null;candidate.dates=null;
  if(m==='sessions'){
   if(!slots.length)throw Error('請至少新增一個場次');
   const valid=slots.map(x=>({...x}));
   for(const x of valid){if(!x.d||!x.s)throw Error('每個場次都需要日期與開始時間');if(x.e&&x.e<=x.s)throw Error('場次結束時間必須晚於開始時間');}
   valid.sort((a,b)=>(a.d+a.s).localeCompare(b.d+b.s));
   candidate.schedule=valid;candidate.dates=[...new Set(valid.map(x=>x.d))];
   candidate.start_at=valid[0].d+'T'+valid[0].s+':00+08:00';
   candidate.end_at=new Date(Math.max(...valid.map(x=>Date.parse(x.d+'T'+(x.e?x.e+':00':'23:59:59')+'+08:00')))).toISOString();
  }
  if(m==='single'&&candidate.start_at){
   const day=local(candidate.start_at).slice(0,10);
   if(candidate.end_at&&local(candidate.end_at).slice(0,10)!==day)throw Error('單日活動須同一天結束，跨日請選跨日／展期');
   if(!candidate.end_at)candidate.end_at=day+'T23:59:59+08:00';
  }
  if(candidate.listing_type==='exhibition'&&(!candidate.start_at||!candidate.end_at))throw Error('展覽需要明確開始及結束日期');
  if(candidate.end_at&&Date.parse(candidate.end_at)<Date.parse(candidate.start_at))throw Error('結束時間不可早於開始時間');
  return candidate;
 };
}
