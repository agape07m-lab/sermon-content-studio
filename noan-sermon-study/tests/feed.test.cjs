'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const Feed=require('../public/feed.js'),{prepare}=require('../scripts/prepare-feed.cjs');
function record(kind,date,rev=1,sequence){
  const key=sequence?kind+'-episode-'+sequence:kind+'-'+date;
  const content='# 완성 원고\n\n'+('성경의 문맥을 살피고 성도들의 삶에 말씀을 전합니다.\n\n').repeat(80)+'\n기도합니다. 아멘. '+rev;
  return {id:key,manuscriptId:key,kind,date,sequence,status:'full',title:'완성 원고',passage:'시편 1편 1–6절',sourceTimestamp:`2026-11-${String(10+rev).padStart(2,'0')}T00:00:00Z`,sourceMessageId:'message-'+rev,content,review:{completion:'passed',privacy:'passed',contentSha256:crypto.createHash('sha256').update(content).digest('hex')}};
}
const empty=()=>({schema:1,updatedAt:'2026-11-01T00:00:00Z',items:[]});
test('분야마다 서로 다른 최근 두 편, 새벽예배 보존',()=>{
  const rows=Feed.KINDS.flatMap(k=>[record(k,'2026-11-01'),record(k,'2026-11-08'),record(k,'2026-11-15')]);
  const r=prepare(empty(),rows);const parsed=Feed.parse(r);
  for(const k of Feed.TARGETS){assert.equal(parsed.groups[k].length,2);assert.deepEqual(parsed.groups[k].map(x=>x.date),['2026-11-15','2026-11-08']);assert.equal(parsed.groups[k][0].id,k);}
  assert.equal(parsed.groups.dawn.length,1);
});
test('같은 원고 수정은 한 칸만 교체하고 과거 수정이 최근 원고를 밀어내지 않는다',()=>{
  const base=prepare(empty(),[record('sunday','2026-11-08'),record('sunday','2026-11-15')]);
  const r=prepare(base,[record('sunday','2026-11-08',2)]);
  assert.deepEqual(r.items.map(x=>x.date),['2026-11-15','2026-11-08']);assert.match(r.items[1].content,/2$/);
  assert.strictEqual(prepare(r,[record('sunday','2026-11-08',1)]),r);
});
test('중복 실행은 갱신 시각도 바꾸지 않는다',()=>{
  const rows=[record('wednesday','2026-11-11'),record('wednesday','2026-11-18')];
  const r=prepare(empty(),rows);assert.strictEqual(prepare(r,rows),r);
});
test('다른 분야, 알 수 없는 부가 필드, schema 1 유지',()=>{
  const base=prepare({...empty(),extension:{keep:true}},[record('sunday','2026-11-15')]);
  const r=prepare(base,[record('wednesday','2026-11-18')]);
  assert.equal(r.schema,1);assert.deepEqual(r.extension,{keep:true});assert.deepEqual(r.items.find(x=>x.kind==='sunday'),base.items[0]);
});
test('예배일 없는 성경개관은 회차로 순서를 정한다',()=>{
  const r=prepare(empty(),[record('overview','',1,18),record('overview','2026-11-15',1,19),record('overview','2026-11-22',1,20)]);
  assert.deepEqual(r.items.map(x=>x.sequence),[20,19]);
});
test('기존 새벽예배 legacy 레코드는 읽고 보존한다',()=>{
  const legacy=record('dawn','2026-11-20');delete legacy.review;delete legacy.manuscriptId;legacy.id='dawn';
  const r=prepare({...empty(),items:[legacy]},[record('sunday','2026-11-15')]);assert.equal(r.items[0].content,legacy.content);
});
test('불완전·잘린 결과, 검토 누락, 본문 변조, 개인정보 의심은 거부',()=>{
  for(const edit of [r=>r.status='draft',r=>delete r.review,r=>r.review.privacy='pending',r=>r.content+='\n수정',r=>r.content+='\n010-1234-5678',r=>r.content+='\nmember@example.com',r=>r.content+='\n[날짜]',r=>r.content='파일 링크만 안내',r=>r.manuscriptId='wrong']){
    const r=record('sunday','2026-11-15');edit(r);assert.throws(()=>prepare(empty(),[r]));
  }
});
test('시각 충돌과 잘못된 날짜·스키마는 조용히 덮어쓰지 않는다',()=>{
  const a=record('sunday','2026-11-15'),b=record('sunday','2026-11-15',2);b.sourceTimestamp=a.sourceTimestamp;
  assert.throws(()=>prepare(empty(),[a,b]));assert.equal(Feed.validDate('2026-02-30'),false);assert.equal(Feed.validDate('2026-99-99'),false);assert.throws(()=>Feed.parse({schema:2,items:[]}));
});
test('검토 상태는 원문 해시에 결합된다',()=>{
  const r=record('sunday','2026-11-15');r.content+='\n원문이 바뀌었습니다.';assert.throws(()=>prepare(empty(),[r]),/검토한 원문/);
});
