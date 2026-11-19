(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.NoanFeed=api;
})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const KINDS=['dawn','wednesday','sunday','overview'];
  const TARGETS=['wednesday','sunday','overview'];
  const LIMIT=2;
  const unsafePatterns=[
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /(?:\+82[ -]?)?0?1[016789][ -]?\d{3,4}[ -]?\d{4}/,
    /\b\d{6}\s*[-–]\s*[1-8]\d{6}\b/,
    /(?:sk-proj-|gh[pousr]_|github_pat_)[a-zA-Z0-9_]{10,}/,
    /(?:계좌번호|비밀번호|인증번호|access[_ ]?token|api[_ ]?key)\s*[:：=]/i,
    /(?:^|[\s“‘"'(])(?:김|이|박|최|정|강|조|윤|장|임|한|오|서|신|권|황|안|송|유|홍|전|고|문|양|손|배|백|허|남|심|노|하)[가-힣]{1,3}\s*(?:성도님|집사님?|권사님?|장로님?)(?:께서|께서는|은|는|이|가|의)/
  ];
  const incompletePatterns=[/\[(?:날짜|이름|원고|내용|추가|작성|미정)[^\]]*\]/,/\b(?:TODO|TBD|PLACEHOLDER)\b/i,/(?:이하|중간|본문)\s*생략/,/(?:추후|나중에)\s*(?:작성|보완)/,/:::writing\{/];
  const cleanText=s=>String(s||'').replace(/\r\n/g,'\n').trim();
  function validDate(s){const d=new Date(s+'T00:00:00Z');return /^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s;}
  function contentIssues(content){
    const s=cleanText(content),issues=[];
    if(s.length<1800||s.length>100000)issues.push('원고 분량 확인 필요');
    if(unsafePatterns.some(re=>re.test(s)))issues.push('개인정보 또는 비밀정보 의심');
    if(incompletePatterns.some(re=>re.test(s)))issues.push('미완성 표시');
    return issues;
  }
  function identity(o){
    if(o.kind==='overview'&&Number.isInteger(o.sequence)&&o.sequence>0)return 'overview-episode-'+o.sequence;
    if(validDate(o.date||''))return o.kind+'-'+o.date;
    throw new Error('예배일 또는 성경개관 회차를 확인해 주세요.');
  }
  function validate(o,{legacy=false}={}){
    if(!o||!KINDS.includes(o.kind)||o.status!=='full')throw new Error('완료 원고 형식이 아닙니다.');
    if(typeof o.content!=='string'||!cleanText(o.title)||!cleanText(o.passage))throw new Error('원고 기본 정보가 없습니다.');
    if(!Number.isFinite(Date.parse(o.sourceTimestamp)))throw new Error('완료 시각이 없습니다.');
    const issues=contentIssues(o.content+'\n'+o.title+'\n'+o.passage);
    if(issues.length)throw new Error(issues.join(', '));
    const key=identity(o);
    if(!legacy&&(!o.review||o.review.completion!=='passed'||o.review.privacy!=='passed'||!/^([a-f0-9]{64})$/.test(o.review.contentSha256||'')||o.manuscriptId!==key||!cleanText(o.sourceMessageId)))throw new Error('원문 전체의 완료·개인정보 검토가 필요합니다.');
    return {...o,manuscriptId:key};
  }
  function compare(a,b){
    if(a.kind==='overview'&&a.sequence&&b.sequence&&a.sequence!==b.sequence)return b.sequence-a.sequence;
    return (b.date||'').localeCompare(a.date||'')||Date.parse(b.sourceTimestamp)-Date.parse(a.sourceTimestamp);
  }
  function select(items,kind){
    const map=new Map();
    for(const o of items.filter(o=>o.kind===kind)){
      const key=identity(o),old=map.get(key);
      if(!old||Date.parse(o.sourceTimestamp)>Date.parse(old.sourceTimestamp))map.set(key,o);
      else if(Date.parse(o.sourceTimestamp)===Date.parse(old.sourceTimestamp)&&o.content!==old.content)throw new Error('같은 완료 시각의 서로 다른 원고가 있습니다.');
    }
    return [...map.values()].sort(compare).slice(0,kind==='dawn'?1:LIMIT);
  }
  function parse(raw){
    if(!raw||raw.schema!==1||!Array.isArray(raw.items)||raw.items.length>100)throw new Error('원고 목록 형식이 올바르지 않습니다.');
    const list=raw.items.map(o=>validate(o,{legacy:o?.kind==='dawn'&&!o?.review}));
    if(new Set(list.map(o=>o.id)).size!==list.length)throw new Error('원고 ID가 중복됩니다.');
    const groups={};for(const kind of KINDS)groups[kind]=select(list,kind);
    return {groups,updatedAt:String(raw.updatedAt||'')};
  }
  function merge(raw,incoming,now){
    parse(raw);
    const next=incoming.map(o=>validate(o));
    const all=[...raw.items,...next];
    const items=[];
    for(const kind of KINDS){
      const selected=select(all,kind);
      selected.forEach((o,i)=>items.push({...o,id:i===0?kind:o.manuscriptId}));
    }
    const changed=JSON.stringify(items)!==JSON.stringify(raw.items);
    return changed?{...raw,updatedAt:now,items}:raw;
  }
  return {KINDS,TARGETS,LIMIT,cleanText,validDate,identity,contentIssues,validate,parse,merge};
});
