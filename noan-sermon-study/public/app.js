'use strict';
/** Additional offline-first PWA interface. The existing sermon schema and editors are preserved. */
(() => {
  const APP_VERSION = '2.3.0-plus-workflow';
  const INBOX_KEY = 'noan_sermon_private_inbox_v2';
  const REMOTE_CACHE_KEY = 'noan_sermon_remote_read_cache_v1';
  // This is a public read-only feed. Do not publish confidential pastoral notes here.
  const FEED_URL = 'https://raw.githubusercontent.com/agape07m-lab/sermon-content-studio/main/noan-sermon-study/latest.json';
  let remote = {};
  let refreshInFlight=false;
  let lastCheckedAt='';
  let feedUpdatedAt = '';
  let feedError = '';
  const tasks = [
    {id:'dawn', name:'새벽예배', label:'다음 새벽예배 설교', kind:'dawn', schedule:'월–토 오전 6:30', latest:'메마른 땅에서 하나님을 찾다', passage:'시편 63:1–11', original:'2026-11-19'},
    {id:'wednesday', name:'수요기도회', label:'다음 수요기도회 설교·예배 준비', kind:'wednesday', schedule:'토요일 오전 6:30', latest:'누군가의 믿음이 길이 될 때', passage:'마가복음 2:1–12', original:'2026-11-18'},
    {id:'sunday', name:'주일예배', label:'주일예배 설교', kind:'sunday', schedule:'대화에서 완성한 원고', latest:'주일예배 설교', passage:'', original:''},
    {id:'overview', name:'성경개관', label:'주일 오후예배 성경개관 준비', kind:'overview', schedule:'금요일 오전 8:00', latest:'19주차 마가복음', passage:'마가복음', original:'2026-11-15'}
  ];
  let inbox = {};
  let currentTaskId = 'dawn';
  let currentScreen = 'home';
  const el = s => document.querySelector(s);
  const all = s => Array.from(document.querySelectorAll(s));
  const escapeHTML = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const shorten = (s,n=70) => s && s.length>n ? s.slice(0,n)+'…' : (s||'');
  const getTask = id => tasks.find(t=>t.id===id)||tasks[0];
  const getLocalResult = id => inbox[id]&&typeof inbox[id].content==='string'&&inbox[id].content.trim()?inbox[id]:null;
  const getRemoteResults = kind => remote[kind]||[];
  const getRemoteResult = id => Object.values(remote).flat().find(o=>o.id===id)||getRemoteResults(id)[0]||null;
  function parseRemote(raw){
    const result=NoanFeed.parse(raw);
    return {items:result.groups,updatedAt:result.updatedAt};
  }
  function loadRemoteCache(){
    try{const r=parseRemote(JSON.parse(localStorage.getItem(REMOTE_CACHE_KEY)||'null'));remote=r.items;feedUpdatedAt=r.updatedAt;}
    catch{remote={};}
  }
  function renderFeedStatus(){
    const status=el('#feedStatus');if(!status)return;
    status.textContent=feedError?'새 원고 확인 실패 · 저장된 사본 표시 · '+feedError:lastCheckedAt?'최근 확인: '+when(lastCheckedAt)+' · 목록 갱신: '+when(feedUpdatedAt):feedUpdatedAt?'저장된 사본 · 목록 갱신: '+when(feedUpdatedAt):'원고 목록을 아직 받지 못했습니다.';
  }
  async function refreshRemoteFeed(showMessage=false){
    if(refreshInFlight)return;
    if(!navigator.onLine){feedError='인터넷 연결 없음';renderFeedStatus();if(showMessage)toast('오프라인입니다. 저장된 원고를 확인해 주세요.');return;}
    refreshInFlight=true;
    const status=el('#feedStatus');if(status)status.textContent='최신 원고 확인 중…';
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await fetch(FEED_URL+'?v='+Date.now(),{cache:'no-store',mode:'cors',signal:controller.signal});
      if(!response.ok)throw new Error('원고 자료에 접근할 수 없습니다.');
      const raw=await response.json();const parsed=parseRemote(raw);
      if(!raw.items.length&&Object.values(remote).flat().length)throw new Error('빈 목록 수신 · 기존 원고 유지');
      remote=parsed.items;feedUpdatedAt=parsed.updatedAt;feedError='';lastCheckedAt=new Date().toISOString();
      try{localStorage.setItem(REMOTE_CACHE_KEY,JSON.stringify(raw));}catch{}
      renderHome();renderInbox();
      if(showMessage)toast('원고 목록을 확인했습니다.');
    }catch(err){feedError=err?.name==='AbortError'?'응답 시간 초과':err?.message||'네트워크 확인 실패';if(showMessage)toast('새 원고를 불러오지 못했습니다. 저장된 사본을 표시합니다.');}
    finally{clearTimeout(timer);refreshInFlight=false;renderFeedStatus();}
  }
  function toReaderHTML(content){
    const inline=s=>escapeHTML(s).replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>').replace(/\*([^*\n]+)\*/g,'<em>$1</em>');
    const chunks=content.replace(/\r/g,'').split(/\n\s*\n/).filter(x=>x.trim());
    return chunks.map(c=>{
      const lines=c.trim().split('\n');
      const hd=lines[0].match(/^(#{1,3})\s+(.*)$/);
      if(hd){const tag=hd[1].length===1?'h2':hd[1].length===2?'h3':'h4';return `<${tag}>${inline(hd[2])}</${tag}>`+(lines.length>1?'<p>'+lines.slice(1).map(inline).join('<br>')+'</p>':'');}
      if(lines.every(x=>/^\s*[-*]\s+/.test(x)))return '<ul>'+lines.map(x=>'<li>'+inline(x.replace(/^\s*[-*]\s+/,''))+'</li>').join('')+'</ul>';
      if(lines.every(x=>/^\s*\d+[.)]\s+/.test(x)))return '<ol>'+lines.map(x=>'<li>'+inline(x.replace(/^\s*\d+[.)]\s+/,''))+'</li>').join('')+'</ol>';
      return '<p>'+lines.map(inline).join('<br>')+'</p>';
    }).join('');
  }
  let readingTaskId='dawn';
  let readingRecord=null;
  function openReader(id){
    const r=getRemoteResult(id);
    if(!r){openSaved(id);return;}
    readingTaskId=r.kind;readingRecord={...r};
    el('#readerTitle').textContent=r.title;
    el('#readerMeta').textContent=getTask(r.kind).name+' · '+(r.passage||'')+' · '+recordDate(r)+' · '+(r.origin||'완료 원고');
    el('#readerContent').innerHTML=toReaderHTML(r.content);
    el('#readerDialog').hidden=false;
    el('#readerDialog .reader-body').scrollTop=0;
    el('#readerClose').focus();
  }
  function closeReader(){el('#readerDialog').hidden=true;}
  function saveRemoteToCard(){
    const r=readingRecord;if(!r)return;
    currentTaskId=readingTaskId;
    el('#extraText').value=r.content;
    closeReader();
    saveImported(r);
  }
  const when = iso => iso? new Date(iso).toLocaleString('ko-KR',{year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';
  function loadInbox(){
    try{const raw=JSON.parse(localStorage.getItem(INBOX_KEY)||'{}');if(raw&&typeof raw==='object')inbox=raw;}
    catch{inbox={};}
  }
  function saveInbox(){
    try{localStorage.setItem(INBOX_KEY,JSON.stringify(inbox));}
    catch{toast('기기 저장 공간이 부족합니다. 원고를 복사하여 보관하세요.');}
  }
  const recordDate = r => r.date|| (r.sequence?r.sequence+'주차 · 예배일 미확인':'예배일 미확인');
  function remoteCard(r,index){
    return `<div class="completed-record"><span class="record-label">${index===0?'최근 완료본':'직전 완료본'}</span><h4>${escapeHTML(r.title)}</h4><p class="sub">${escapeHTML(recordDate(r))} · ${escapeHTML(r.passage)}</p><button type="button" class="${index===0?'solid':'soft'}-button" data-read-remote="${escapeHTML(r.id)}">${index===0?'최근 원고 읽기':'직전 원고 읽기'}</button></div>`;
  }
  function renderHome(){
    el('#homeSchedules').innerHTML=tasks.map(t=>{
      const records=getRemoteResults(t.kind),saved=getLocalResult(t.id);
      return `<article class="sched-card"><span class="pill">${escapeHTML(t.name)}</span><p class="sub">${escapeHTML(t.schedule)}</p>${records.map(remoteCard).join('')||'<p>연결된 완료 원고가 없습니다.</p>'}${t.kind!=='dawn'&&records.length===1?'<p class="sub">직전 완료본은 아직 확인되지 않았습니다.</p>':''}<div class="actions">${saved?`<button type="button" class="soft-button" data-open-inbox="${t.id}">기기 저장본</button>`:''}<button type="button" class="soft-button" data-import="${t.id}">원고 붙여넣기</button></div></article>`;
    }).join('');
    const p=active();
    el('#homeRecent').innerHTML=p?`<button type="button" class="note-card" id="openRecent"><div><span class="pill">${escapeHTML(MODES[p.kind]?.name||'설교')}</span><h4>${escapeHTML(p.title||'제목 없는 설교')}</h4><p>${escapeHTML(p.passage||'본문 미정')} · ${escapeHTML(p.date||'')}</p></div><span style="font-size:25px;color:#ac957d">›</span></button>`:
    '<button type="button" class="note-card" id="createEmpty"><div><h4>아직 저장한 설교가 없습니다.</h4><p>새 설교를 시작하거나 백업 파일을 가져오세요.</p></div><span style="font-size:25px;color:#ac957d">＋</span></button>';
  }
  function renderInbox(){
    el('#inboxRows').innerHTML=tasks.map(t=>{
      const records=getRemoteResults(t.kind),saved=getLocalResult(t.id);
      return `<section class="inbox-group"><h3>${escapeHTML(t.name)}</h3>${records.map((r,i)=>`<article class="inbox-row"><div><span class="record-label">${i===0?'최근 완료본':'직전 완료본'}</span><h4>${escapeHTML(r.title)}</h4><p class="sub">${escapeHTML(recordDate(r))} · ${escapeHTML(r.passage)}</p></div><button type="button" class="solid-button" data-read-remote="${escapeHTML(r.id)}">원고 전문 읽기</button></article>`).join('')||'<p>연결된 완료 원고가 없습니다.</p>'}${t.kind!=='dawn'&&records.length<2?'<p class="sub">확인된 완료본만 표시합니다. 직전 원고를 확인하면 함께 표시됩니다.</p>':''}<div class="actions">${saved?`<button type="button" class="soft-button" data-open-inbox="${t.id}">기기 저장본</button>`:''}<button type="button" class="soft-button" data-import="${t.id}">직접 가져오기</button></div></section>`;
    }).join('');
    renderFeedStatus();
  }
  function go(screen){
    if(screen==='editor'&&!active())newProject('sunday');
    currentScreen=screen;
    el('#pageHome').hidden=screen!=='home';
    el('#pageInbox').hidden=screen!=='inbox';
    el('#appLayout').hidden=!(screen==='editor'||screen==='archive');
    for(const b of all('[data-screen]'))b.setAttribute('aria-current',b.dataset.screen===screen?'page':'false');
    if(screen==='home')renderHome();
    if(screen==='inbox')renderInbox();
    if(screen==='editor'||screen==='archive'){render();if(screen==='editor'&&activeTab==='prepare')switchTab('draft');}
    window.scrollTo(0,0);
  }
  function startNew(kind='sunday'){newProject(kind);go('editor');}
  function openDialog(id){currentTaskId=id;const t=getTask(id);el('#extraTitle').textContent=t.name+' · 원고 가져오기';el('#extraHint').textContent='완성된 설교문을 붙여 넣거나 텍스트 파일을 선택하세요. 저장하면 기기 안의 예약 원고함과 설교 기록에 보관합니다.';el('#extraText').value='';el('#extraDialog').hidden=false;el('#extraText').focus();}
  function closeDialog(){el('#extraDialog').hidden=true;}
  function detectMeta(content,task){
    const line=content.split('\n').map(s=>s.trim()).find(s=>/^#\s+/.test(s));
    const title=line?line.replace(/^#+\s*/, '').replace(/[\*#]/g,'').trim():task.latest;
    const match=content.match(/(?:\*\*)?본문(?:\*\*)?\s*[:：]\s*(?:\*\*)?([^\n]+)/);
    const passage=(match?match[1].replace(/[*_]/g,'').trim():task.passage).slice(0,160);
    const date=content.match(/(20\d{2})년\s*(\d{1,2})월\s*(\d{1,2})일/);
    const finalDate=date?`${date[1]}-${date[2].padStart(2,'0')}-${date[3].padStart(2,'0')}`:localToday();
    return {title:(title||task.latest).slice(0,200),passage,date:finalDate};
  }
  function saveImported(source=null){
    const content=el('#extraText').value.trim();if(!content){toast('원고를 먼저 입력해 주세요.');return;}
    if(content.length>600000){toast('원고가 너무 깁니다. 60만 자 이하로 나누어 가져오세요.');return;}
    const task=getTask(currentTaskId),parsed=source?.manuscriptId?{title:source.title,passage:source.passage,date:source.date||''}:detectMeta(content,task);
    inbox[task.id]={content,title:parsed.title,savedAt:new Date().toISOString(),passage:parsed.passage};
    saveInbox();
    const p=normalizeProject({id:uuid(),kind:task.kind,date:parsed.date,title:parsed.title,passage:parsed.passage,draftText:content,
      series:task.kind==='wednesday'?'주님은 그 사람을 지나치지 않으셨다':task.kind==='overview'?'30주 성경개관':'',
      translation:'개역개정',minutes:MODES[task.kind].minutes,
      notes:'예약 원고함에서 직접 가져온 자료 / 저장: '+new Date().toLocaleDateString('ko-KR')});
    state.projects.unshift(p);state.activeId=p.id;
    persist();render();closeDialog();go('editor');switchTab('draft');
    toast('예약 원고함과 설교 기록에 저장했습니다.');
  }
  function openSaved(id){
    const r=getLocalResult(id);if(!r){openDialog(id);return;}
    const t=getTask(id);
    el('#extraTitle').textContent=r.title||t.latest;
    el('#extraHint').textContent='기기에 보관된 원고입니다. 수정 후 저장하면 새로운 설교 기록으로 보관됩니다.';
    el('#extraText').value=r.content;
    currentTaskId=id;el('#extraDialog').hidden=false;
  }
  async function readPlainFile(file){
    if(!file)return;
    try{
      if(file.size>1500000)throw new Error('1.5MB 이하의 텍스트 파일만 지원합니다.');
      const raw=await file.text();if(!raw.trim())throw new Error('파일 내용이 비어 있습니다.');
      el('#extraText').value=raw;toast('파일 내용을 불러왔습니다. 저장 버튼을 눌러 주세요.');
    }catch(e){toast(e.message||'파일을 읽지 못했습니다.');}
    el('#extraFile').value='';
  }
  function exportAll(){
    const payload={format:'noan-sermon-studio',version:3,exportedAt:new Date().toISOString(),projects:state.projects,inbox,plusWork:window.NoanPlusWork?.export()||{},remoteFeed:{schema:1,updatedAt:feedUpdatedAt,items:Object.values(remote).flat()}};
    download('노안설교연구실_독립앱_전체백업_'+localToday()+'.json',JSON.stringify(payload,null,2),'application/json;charset=utf-8');
    toast('설교 카드와 예약 원고함을 함께 백업했습니다.');
  }
  async function importAll(file){
    if(!file)return;
    try{
      if(file.size>12000000)throw new Error('12MB 이하의 백업 파일만 지원합니다.');
      const data=JSON.parse(await file.text());
      if(data?.format!=='noan-sermon-studio'||!Array.isArray(data.projects))throw new Error('설교연구실 백업 파일이 아닙니다.');
      if(data.projects.length>4000)throw new Error('설교 카드가 너무 많습니다.');
      const cards=data.projects.filter(x=>x&&typeof x==='object'&&typeof x.id==='string').map(normalizeProject);
      const extra=(data.inbox&&typeof data.inbox==='object'&&!Array.isArray(data.inbox))?data.inbox:{};
      if(!cards.length&&!Object.keys(extra).length)throw new Error('가져올 자료가 없습니다.');
      if(!window.confirm(`백업의 설교 ${cards.length}편을 현재 기록과 합칠까요? 동일 ID는 가져온 내용으로 바뀝니다. 현재 자료를 먼저 백업하는 것이 안전합니다.`))return;
      const map=new Map(state.projects.map(x=>[x.id,x]));cards.forEach(x=>map.set(x.id,x));
      state.projects=[...map.values()];state.activeId=cards[0]?.id||state.activeId;
      for(const [id,obj] of Object.entries(extra)){
        if(tasks.some(t=>t.id===id)&&obj&&typeof obj.content==='string'&&obj.content.length<=600000)inbox[id]={content:obj.content,title:String(obj.title||''),passage:String(obj.passage||''),savedAt:String(obj.savedAt||new Date().toISOString())};
      }
      if(data.plusWork)window.NoanPlusWork?.merge(data.plusWork);
      saveInbox();persist();render();renderHome();renderInbox();
      toast(`설교 ${cards.length}편을 가져왔습니다.`);go('archive');
    }catch(e){toast('가져오기 실패: '+(e.message||'파일 오류'));}
    el('#importInput').value='';
  }
  function showUpdate(text){el('#updateMessage').textContent=text;el('#updateStrip').classList.add('show');}
  async function checkVersion(){
    if(!navigator.onLine)return;
    try{
      const response=await fetch('/version.json?check='+Date.now(),{cache:'no-store'});
      if(!response.ok)return;
      const meta=await response.json();
      if(meta.version&&meta.version!==APP_VERSION)showUpdate('새 버전이 준비되었습니다. 저장 중인 원고를 확인한 뒤 업데이트하세요.');
    }catch{}
  }
  function refresh(){
    const editing=el('#appLayout').hidden===false;
    if(editing&&active())persist();
    location.reload();
  }
  function registerOffline(){
    if('serviceWorker' in navigator){
      window.addEventListener('load',()=>{
        navigator.serviceWorker.register('/sw.js').then(reg=>{
          reg.addEventListener('updatefound',()=>{
            const worker=reg.installing;
            worker?.addEventListener('statechange',()=>{
              if(worker.state==='installed'&&navigator.serviceWorker.controller)showUpdate('앱의 새 버전이 준비되었습니다.');
            });
          });
          reg.update().catch(()=>{});
        }).catch(()=>{});
      });
    }
    window.addEventListener('online',()=>{toast('인터넷 연결이 복구되었습니다.');checkVersion();refreshRemoteFeed();});
    window.addEventListener('offline',()=>toast('오프라인 상태입니다. 저장한 원고는 계속 작성할 수 있습니다.'));
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){checkVersion();refreshRemoteFeed();}});
    setInterval(checkVersion,60*60*1000);
    setInterval(()=>{if(document.visibilityState==='visible')refreshRemoteFeed();},5*60*1000);
    checkVersion();
  }
  function attachExtra(){
    // Replace earlier event-only backup controls so v1/v2 Floot backups and v3 inbox backups both work.
    const oldBackup=el('#btnBackup'), backupButton=oldBackup.cloneNode(true);oldBackup.replaceWith(backupButton);
    backupButton.addEventListener('click',exportAll);
    const oldPicker=el('#importInput'), importPicker=oldPicker.cloneNode(true);oldPicker.replaceWith(importPicker);
    importPicker.addEventListener('change',e=>importAll(e.target.files?.[0]));
    document.addEventListener('click',e=>{
      const screen=e.target.closest('[data-screen]');if(screen){go(screen.dataset.screen);return;}
      const article=e.target.closest('[data-read-remote]');if(article){openReader(article.dataset.readRemote);return;}
      const task=e.target.closest('[data-open-inbox]');if(task){const id=task.dataset.openInbox;go('inbox');openSaved(id);return;}
      const imp=e.target.closest('[data-import]');if(imp){openDialog(imp.dataset.import);return;}
      if(e.target.closest('#createHome')||e.target.closest('#createEmpty')){startNew();return;}
      if(e.target.closest('#openRecent')){go('editor');return;}
    });
    el('#extraClose').addEventListener('click',closeDialog);
    el('#readerClose').addEventListener('click',closeReader);
    el('#readerDialog').addEventListener('click',e=>{if(e.target===el('#readerDialog'))closeReader();});
    el('#readerSave').addEventListener('click',saveRemoteToCard);
    el('#readerCopy').addEventListener('click',()=>{const r=readingRecord;if(r)copyText(r.content);});
    el('#feedRefresh').addEventListener('click',()=>refreshRemoteFeed(true));
    el('#extraDialog').addEventListener('click',e=>{if(e.target===el('#extraDialog'))closeDialog();});
    el('#extraSave').addEventListener('click',()=>saveImported());
    el('#extraFileButton').addEventListener('click',()=>el('#extraFile').click());
    el('#extraFile').addEventListener('change',e=>readPlainFile(e.target.files?.[0]));
    el('#reloadApp').addEventListener('click',refresh);
    el('#refreshBtn').addEventListener('click',refresh);
    window.addEventListener('keydown',e=>{if(e.key==='Escape'){if(!el('#readerDialog').hidden)closeReader();if(!el('#extraDialog').hidden)closeDialog();}});
    el('#btnImport').addEventListener('click',()=>setTimeout(renderHome,400));
    el('#btnNew').addEventListener('click',()=>setTimeout(()=>go('editor'),0));
    el('#btnDelete').addEventListener('click',()=>setTimeout(renderHome,0));
    el('#btnDuplicate').addEventListener('click',()=>setTimeout(renderHome,0));
  }
  loadInbox();loadRemoteCache();attachExtra();registerOffline();go('home');refreshRemoteFeed();
  window.__noanStudio={version:APP_VERSION,go,renderHome,renderInbox,checkVersion,refreshRemoteFeed};
})();

