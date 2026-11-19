'use strict';
(()=>{
  const HISTORY_KEY='noan_sermon_plus_work_v1';
  const $=s=>document.querySelector(s);
  const stageNames={draft:'초안 작성',review:'원고 검토',revise:'검토 반영 수정',polish:'문장 다듬기'};
  let history={},connection={state:'loading',sharing:false},busy=false,controller=null,requestProjectId=null,result=null,shownProjectId=null;
  try{history=JSON.parse(localStorage.getItem(HISTORY_KEY)||'{}');if(!history||typeof history!=='object'||Array.isArray(history))history={};}catch{}
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function saveHistory(){try{localStorage.setItem(HISTORY_KEY,JSON.stringify(history));return true;}catch{toast('기기 저장 공간이 부족합니다. 원고를 먼저 백업해 주세요.');return false;}}
  function work(){const id=active()?.id;if(!id)return null;return history[id]||{revisions:[],review:'',finalAt:''};}
  function showState(){
    const p=active(),w=work();
    if(shownProjectId!==p?.id){$('#plusChanges').value=w?.changes||'';shownProjectId=p?.id;}
    $('#plusConnection').textContent=connection.state==='connected'&&connection.sharing?'ChatGPT Plus 포함 사용량으로 연결됨':connection.state==='connected'?'Plus 사용 권한 승인 필요':connection.state==='registration_pending'?'Plus 연결 승인 대기':connection.state==='loading'?'연결 확인 중…':connection.state==='offline'?'인터넷 연결을 확인해 주세요.':'ChatGPT 연결 필요';
    $('#plusConnectionDetail').textContent=connection.message|| (connection.sharing?'작성 요청에 입력한 본문·메모·원고를 사용합니다.':'연결 후 이 화면에서 작성·검토·수정을 진행할 수 있습니다.');
    $('#plusConnect').hidden=connection.state==='registration_pending';
    $('#plusConnect').disabled=busy;
    $('#plusDisconnect').hidden=connection.state!=='connected';
    $('#plusDisconnect').disabled=busy;
    $('#plusAccount').textContent=connection.account?.email||'';
    for(const button of document.querySelectorAll('[data-plus-stage]'))button.disabled=busy||!p||!connection.sharing||(button.dataset.plusStage!=='draft'&&!p.draftText?.trim());
    $('#plusModel').disabled=busy||!connection.sharing;
    $('#plusCancel').hidden=!busy;
    $('#plusStatus').textContent=busy?'원고 작업 중입니다. 완료 전에는 기존 원고를 바꾸지 않습니다.':w?.finalAt&&w.finalText===p?.draftText?'완성본 확정: '+new Date(w.finalAt).toLocaleString('ko-KR'):w?.review?'검토 결과가 있습니다. 수정하거나 문장을 다듬어 보세요.':'본문 준비와 설교 설계에 입력한 내용으로 시작하세요.';
    $('#plusReview').textContent=w?.review||'원고 검토를 실행하면 이곳에 검토 결과가 표시됩니다.';
    $('#plusRestore').disabled=busy||!w?.revisions?.length;
    $('#plusFinal').disabled=busy||!p?.draftText?.trim();
    $('#plusOpenResult').hidden=!result||result.projectId!==p?.id;
  }
  async function api(path,options={}){
    let response;
    try{response=await fetch('/api/gpt/'+path,{credentials:'same-origin',cache:'no-store',...options});}catch(e){if(e.name==='AbortError')throw e;throw new Error('연결이 끊겼습니다. 기존 원고는 유지됩니다.');}
    const type=response.headers.get('Content-Type')||'';if(!type.includes('application/json'))throw new Error('Plus 연결을 준비 중입니다. 기존 원고는 그대로 보관됩니다.');
    const body=await response.json();if(!response.ok){const error=new Error(body.message||'요청을 완료하지 못했습니다.');error.code=body.error;throw error;}return body;
  }
  async function checkConnection(){
    if(busy)return;
    try{connection=await api('status');if(connection.sharing){const data=await api('models');$('#plusModel').innerHTML=data.models.map(m=>`<option value="${escape(m.id)}">${escape(m.name)}</option>`).join('');if(!data.models.length){connection.sharing=false;connection.message='사용 가능한 모델을 확인하지 못했습니다.';}}}
    catch(e){connection={state:e.code==='registration_pending'?'registration_pending':navigator.onLine?'error':'offline',sharing:false,message:e.message};}
    showState();
  }
  function projectContext(p){const context={};for(const field of ['kind','date','title','passage','sourceText','notes','sermonStyle','translation','series','narrative','theology','audience','minutes','thesis','point1','point2','gospel','intro','apply1','apply2','apply3','difference','draftText'])context[field]=p[field]||'';context.review=work()?.review||'';context.changes=$('#plusChanges').value;return context;}
  function dialogResult(data){result=data;$('#plusResultTitle').textContent=stageNames[data.stage]+' 결과';$('#plusResultText').value=data.content;$('#plusApply').textContent=data.stage==='review'?'검토 결과 저장':'현재 원고에 반영';$('#plusResultDialog').hidden=false;$('#plusApply').focus();}
  async function run(stage){
    const p=active();if(!p||busy)return;if(!p.passage?.trim()){toast('본문 준비에서 성경 본문 범위를 입력해 주세요.');return;}
    const model=$('#plusModel').value;if(!model){toast('사용할 모델을 먼저 확인해 주세요.');return;}
    const baseDraft=p.draftText||'';busy=true;requestProjectId=p.id;controller=new AbortController();showState();
    try{const data=await api('run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({stage,model,context:projectContext(p)}),signal:controller.signal});if(data.completed!==true||data.billing!=='chatgpt_plan'||typeof data.content!=='string'||!data.content.trim())throw new Error('완료된 원고를 확인하지 못했습니다.');dialogResult({projectId:requestProjectId,baseDraft,stage,content:data.content,createdAt:new Date().toISOString()});}
    catch(e){toast(e.name==='AbortError'?'작업을 중단했습니다. 기존 원고는 유지됩니다.':e.message);}
    finally{busy=false;controller=null;showState();}
  }
  function applyResult(){
    const p=active();if(!p||p.id!==result?.projectId){toast('작업을 요청한 설교 카드를 먼저 열어 주세요.');return;}
    if((p.draftText||'')!==result.baseDraft){toast('요청 후 원고가 바뀌었습니다. 결과를 확인하고 원고를 직접 합쳐 주세요.');return;}
    const old=work(),next=structuredClone(old);next.finalAt='';
    if(result.stage==='review')next.review=result.content;
    else {next.revisions=[{content:p.draftText||'',at:new Date().toISOString()},...(next.revisions||[])].slice(0,10);}
    history[p.id]=next;if(!saveHistory()){history[p.id]=old;return;}
    if(result.stage!=='review'){p.draftText=result.content;persist();render();switchTab('draft');}
    $('#plusResultDialog').hidden=true;result=null;showState();toast('결과를 이 기기에 저장했습니다.');
  }
  function restore(){const p=active(),old=work();if(!p||!old?.revisions?.length)return;const next=structuredClone(old);const previous=next.revisions.shift();next.finalAt='';history[p.id]=next;if(!saveHistory()){history[p.id]=old;return;}p.draftText=previous.content;persist();render();switchTab('draft');showState();toast('이전 원고를 복원했습니다.');}
  function confirmFinal(){const p=active();if(!p?.draftText?.trim())return;const old=work();history[p.id]={...old,finalText:p.draftText,finalAt:new Date().toISOString()};if(!saveHistory()){history[p.id]=old;return;}showState();toast('현재 원고를 완성본으로 표시했습니다. 공개 게시하지 않습니다.');}
  const panel=document.createElement('section');panel.className='panel plus-panel';panel.id='plusPanel';panel.innerHTML=`<div class="plus-header"><div><h3>GPT와 함께 설교 완성하기</h3><p class="help">본문과 생각을 입력한 뒤 초안을 만들고, 검토와 수정을 거쳐 완성본으로 저장하세요.</p></div><span class="plus-badge">Plus 포함 사용량</span></div><div class="plus-connection"><strong id="plusConnection" role="status">연결 확인 중…</strong><span id="plusAccount"></span><p id="plusConnectionDetail"></p><div class="plus-actions"><a id="plusConnect" class="btn" href="/api/gpt/connect">ChatGPT로 연결</a><button type="button" class="btn btn-small" id="plusCheck">연결 다시 확인</button><button type="button" class="btn btn-small" id="plusDisconnect" hidden>연결 해제</button><a class="btn btn-small" href="https://chatgpt.com/settings/usage" target="_blank" rel="noopener noreferrer">사용량 확인</a></div></div><div class="field"><label for="plusModel">사용할 GPT 모델</label><select id="plusModel" disabled><option value="">계정 연결 후 선택할 수 있습니다.</option></select></div><div class="field" style="margin-top:14px"><label for="plusChanges">전하고 싶은 생각과 이번 수정 요청</label><textarea id="plusChanges" placeholder="강조할 메시지, 담고 싶은 경험, 고치고 싶은 부분을 적어 주세요."></textarea></div><div class="plus-actions plus-stages">${Object.entries(stageNames).map(([key,name])=>`<button type="button" class="btn ${key==='draft'?'btn-primary':''}" data-plus-stage="${key}" disabled>${name}</button>`).join('')}</div><p id="plusStatus" role="status" aria-live="polite"></p><button type="button" class="btn" id="plusCancel" hidden>작업 중단</button><details><summary>검토 결과 보기</summary><div id="plusReview" class="plus-review"></div></details><div class="plus-actions"><button type="button" class="btn" id="plusOpenResult" hidden>받은 결과 다시 보기</button><button type="button" class="btn" id="plusRestore" disabled>이전 원고로 되돌리기</button><button type="button" class="btn btn-primary" id="plusFinal" disabled>완성본으로 확정</button></div><p class="help">결과를 읽고 반영할 때 기존 원고의 사본을 보관합니다. 완성본 확정은 이 기기에 저장하는 표시이며 공개 원고함에 게시하지 않습니다.</p>`;
  $('#pane-draft').prepend(panel);
  const dialog=document.createElement('div');dialog.id='plusResultDialog';dialog.className='modal-shade';dialog.hidden=true;dialog.innerHTML='<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="plusResultTitle"><div class="dialog-title"><h2 id="plusResultTitle">작업 결과</h2><button type="button" class="btn" id="plusClose">닫기</button></div><p>결과를 확인한 뒤 반영하세요. 닫아도 현재 작업 결과는 다시 열어 볼 수 있습니다.</p><textarea id="plusResultText" aria-label="GPT 작업 결과" readonly></textarea><div class="plus-actions"><button type="button" class="btn btn-primary" id="plusApply">현재 원고에 반영</button></div></div>';
  document.body.append(dialog);
  document.querySelectorAll('[data-plus-stage]').forEach(b=>b.addEventListener('click',()=>run(b.dataset.plusStage)));
  $('#plusCheck').addEventListener('click',checkConnection);$('#plusCancel').addEventListener('click',()=>controller?.abort());$('#plusApply').addEventListener('click',applyResult);$('#plusClose').addEventListener('click',()=>dialog.hidden=true);$('#plusOpenResult').addEventListener('click',()=>result&&dialogResult(result));$('#plusRestore').addEventListener('click',restore);$('#plusFinal').addEventListener('click',confirmFinal);
  $('#plusDisconnect').addEventListener('click',async()=>{if(busy)return;try{const data=await api('logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});toast(data.message);await checkConnection();}catch(e){toast(e.message);}});
  document.addEventListener('click',e=>{if(e.target.closest('[data-id], [data-screen], [data-tab], #btnNew, #btnDuplicate, #btnDelete'))setTimeout(showState,0);});
  document.addEventListener('input',e=>{if(e.target.id==='plusChanges'){const p=active();if(p){history[p.id]={...work(),changes:e.target.value};saveHistory();}}if(e.target.id==='draftText'){const p=active();if(p&&history[p.id]?.finalAt){history[p.id].finalAt='';saveHistory();}showState();}});
  document.addEventListener('noan:project-changed',showState);
  $('#plusConnect').addEventListener('click',e=>{if(busy)e.preventDefault();});
  window.addEventListener('online',checkConnection);window.addEventListener('keydown',e=>{if(e.key==='Escape')dialog.hidden=true;});
  // Optional backup field preserves older project formats. Never export credentials.
  window.NoanPlusWork={export:()=>structuredClone(history),merge:raw=>{if(!raw||typeof raw!=='object'||Array.isArray(raw))return;for(const [id,value] of Object.entries(raw))if(!['__proto__','constructor','prototype'].includes(id)&&value&&Array.isArray(value.revisions)&&value.revisions.length<=10){const valid=value.revisions.every(r=>r&&typeof r.content==='string'&&r.content.length<=100000);if(valid)history[id]={revisions:value.revisions.map(r=>({content:r.content,at:typeof r.at==='string'?r.at:''})),review:typeof value.review==='string'?value.review.slice(0,100000):'',changes:typeof value.changes==='string'?value.changes.slice(0,100000):'',finalAt:typeof value.finalAt==='string'?value.finalAt:'',finalText:typeof value.finalText==='string'?value.finalText.slice(0,100000):''};}shownProjectId=null;saveHistory();showState();}};
  showState();checkConnection();
})();
