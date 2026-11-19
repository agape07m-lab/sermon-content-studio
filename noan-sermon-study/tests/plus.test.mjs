import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PlanError,PLAN_SCOPE,requirePlanConfig,seal,unseal,verifyIdentity,base64url,generationBody,completedText} from '../src/plus-core.mjs';
import worker,{PlusSessions} from '../src/worker.mjs';
const origin='https://black-feather-52eb.noan-central-3354fde.workers.dev';
const env=()=>({PUBLIC_ORIGIN:origin,PLUS_HOSTED_APPROVED:'true',PLUS_INCLUDED_ONLY_VERIFIED:'true',PLUS_CLIENT_ID:'oaiapp_fixture',PLUS_STORAGE_KEY:'11'.repeat(32)});
const storage=()=>{const data=new Map();return {data,get:async k=>structuredClone(data.get(k)),put:async(k,v)=>data.set(k,structuredClone(v)),delete:async k=>data.delete(k),list:async()=>data,setAlarm:async()=>{}};};
const encoder=new TextEncoder();
function sse(items,{width=17,crlf=false}={}){let text=items.map(x=>'data: '+JSON.stringify(x)+'\n\n').join('');if(crlf)text=text.replace(/\n/g,'\r\n');const bytes=encoder.encode(text);return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=width)c.enqueue(bytes.slice(i,i+width));c.close();}}),{headers:{'Content-Type':'text/event-stream'}});}
const keypair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const pub={...await crypto.subtle.exportKey('jwk',keypair.publicKey),kid:'fixture-key',use:'sig',alg:'RS256'};
async function jwt(overrides={}){const head=base64url(encoder.encode(JSON.stringify({alg:'RS256',kid:'fixture-key'})));const now=Math.floor(Date.now()/1000);const body=base64url(encoder.encode(JSON.stringify({iss:'https://auth.openai.com',aud:'oaiapp_fixture',sub:'fixture-user',nonce:'fixture-nonce',iat:now,exp:now+300,email:'fixture@example.invalid',...overrides})));const sig=base64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keypair.privateKey,encoder.encode(head+'.'+body)));return head+'.'+body+'.'+sig;}
test('공식 등록·암호화 준비 전 연결과 과금 요청을 차단한다',async()=>{
  assert.throws(()=>requirePlanConfig({}),{code:'registration_pending'});assert.throws(()=>requirePlanConfig({...env(),PLUS_STORAGE_KEY:''}),{code:'connection_unavailable'});
  assert.throws(()=>requirePlanConfig({...env(),PLUS_INCLUDED_ONLY_VERIFIED:'false'}),{code:'credit_policy_unverified'});
  const app=new PlusSessions({storage:storage()},{});const r=await app.fetch(new Request(origin+'/api/gpt/status'));assert.equal(r.status,503);assert.equal((await r.json()).error,'registration_pending');
  const out=await worker.fetch(new Request(origin+'/api/gpt/run'),{ASSETS:{fetch(){throw Error('API must not become HTML');}}});assert.equal(out.status,503);
});
test('세션과 갱신 자격은 암호화하며 변조된 보관본은 해독하지 못한다',async()=>{
  const value={access_token:'fixture-only',refresh_token:'fixture-refresh'};const box=await seal(value,env().PLUS_STORAGE_KEY);assert.ok(!JSON.stringify(box).includes('fixture'));assert.deepEqual(await unseal(box,env().PLUS_STORAGE_KEY),value);await assert.rejects(()=>unseal(box,'22'.repeat(32)));
});
test('로그인 서명·발급자·계정·만료·nonce를 검증한다',async()=>{
  const options={clientId:'oaiapp_fixture',nonce:'fixture-nonce'};const good=await jwt();assert.equal((await verifyIdentity(good,{keys:[pub]},options)).subject,'fixture-user');
  for(const changes of [{iss:'https://attacker.invalid'},{aud:'another-client'},{nonce:'wrong'},{exp:1},{iat:Date.now()/1000+600},{aud:['oaiapp_fixture','another-client'],azp:'another-client'}])await assert.rejects(()=>jwt(changes).then(token=>verifyIdentity(token,{keys:[pub]},options)),{code:'invalid_identity'});
  const [h,b,s]=good.split('.');await assert.rejects(()=>verifyIdentity(h+'.'+b+'.'+s.slice(0,-5)+'abcde',{keys:[pub]},options));
});
test('유료 키 경로와 지원하지 않는 생성 매개변수를 넣지 않는다',()=>{
  const body=generationBody({stage:'revise',model:'fixture-model',context:{passage:'마가복음 2:1–12',draftText:'현재 원고',review:'검토 결과',changes:'사용자의 요청'}});
  assert.equal(body.store,false);assert.equal(body.stream,true);assert.equal(body.input[0].role,'user');assert.ok(body.instructions.includes('검토 결과'));assert.ok(!('previous_response_id'in body));assert.ok(!('max_output_tokens'in body));
  for(const file of ['worker.mjs','plus-core.mjs']){const source=readFileSync(new URL('../src/'+file,import.meta.url),'utf8');assert.ok(!source.includes('OPENAI_API_KEY'));assert.ok(!source.includes('backend-api'));}
  assert.throws(()=>generationBody({stage:'unknown',model:'m',context:{passage:'시편'}}));assert.throws(()=>generationBody({stage:'polish',model:'m',context:{passage:'시편'}}));
});
test('한 글자·CRLF 경계 스트림도 전문을 복원하고 완료 이벤트를 요구한다',async()=>{
  const content='완성된 한글 원고입니다.\n두 번째 문단입니다.';
  const items=[{type:'response.output_text.delta',delta:content},{type:'response.completed'}];assert.equal(await completedText(sse(items,{width:1,crlf:true})),content);
  await assert.rejects(()=>completedText(sse(items.slice(0,1))),{code:'generation_incomplete'});
  await assert.rejects(()=>completedText(sse([...items,{type:'response.failed'}])),{code:'generation_incomplete'});
  await assert.rejects(()=>completedText(sse([{type:'response.incomplete'}])),{code:'generation_incomplete'});
});
test('위조 출처·로그인 없는 실행·조회하지 않은 API를 차단한다',async()=>{
  const app=new PlusSessions({storage:storage()},env());
  assert.equal((await app.fetch(new Request(origin+'/api/gpt/run',{method:'POST',headers:{Origin:'https://attacker.invalid'}}))).status,403);
  assert.equal((await app.fetch(new Request(origin+'/api/gpt/run',{method:'POST',headers:{Origin:origin}}))).status,401);
});
test('OAuth 취소·state 오류는 코드를 교환하거나 세션을 만들지 않는다',async()=>{
  const store=storage(),app=new PlusSessions({storage:store},env());const r=await app.fetch(new Request(origin+'/api/gpt/connect'));
  assert.equal(r.status,302);const target=new URL(r.headers.get('Location'));assert.equal(target.searchParams.get('client_id'),'oaiapp_fixture');assert.ok(target.searchParams.get('scope').includes(PLAN_SCOPE));assert.equal(target.searchParams.get('redirect_uri'),origin+'/auth/openai/callback');assert.equal(target.searchParams.get('code_challenge_method'),'S256');assert.ok(r.headers.get('Set-Cookie').includes('HttpOnly'));
  const tx=r.headers.get('Set-Cookie').split(';')[0];const bad=await app.fetch(new Request(origin+'/auth/openai/callback?state=wrong&code=fixture',{headers:{Cookie:tx}}));assert.equal(bad.status,401);
  const cancelled=await app.fetch(new Request(origin+'/auth/openai/callback?error=access_denied&state='+target.searchParams.get('state'),{headers:{Cookie:tx}}));assert.equal(cancelled.status,401);assert.equal(store.data.size,0);
});
async function signInFixture({sharing=true,expires=3600}={}){
  const store=storage(),app=new PlusSessions({storage:store},env());const connect=await app.fetch(new Request(origin+'/api/gpt/connect'));const url=new URL(connect.headers.get('Location'));const cookie=connect.headers.get('Set-Cookie').split(';')[0];
  const token=await jwt({nonce:url.searchParams.get('nonce')});const previousFetch=globalThis.fetch;const calls=[];
  globalThis.fetch=async(address,options={})=>{calls.push({address:String(address),options});if(String(address).endsWith('/oauth/token'))return Response.json({access_token:'fixture-access',refresh_token:'fixture-refresh',id_token:token,token_type:'Bearer',expires_in:expires,scope:sharing?'openid email '+PLAN_SCOPE:'openid email'});if(String(address).endsWith('/jwks.json'))return Response.json({keys:[pub]});if(String(address).endsWith('/models'))return Response.json({models:[{visibility:'list',slug:'fixture-model',display_name:'Fixture model'}]});if(String(address).endsWith('/responses'))return sse([{type:'response.output_text.delta',delta:'원고 전체의 마지막 문단까지 완료했습니다.'},{type:'response.completed'}]);throw Error('Unexpected network endpoint');};
  const callback=await app.fetch(new Request(origin+'/auth/openai/callback?state='+url.searchParams.get('state')+'&code=fixture-code',{headers:{Cookie:cookie}}));assert.equal(callback.status,303);const sessionCookie=callback.headers.get('Set-Cookie').match(/__Host-noan_gpt=[\w-]+/)[0];return {app,store,calls,sessionCookie,restore:()=>globalThis.fetch=previousFetch};
}
test('로그인부터 모델 선택·작성까지 포함 사용량 경로만 사용한다',async()=>{
  const fixture=await signInFixture();try{
    const status=await (await fixture.app.fetch(new Request(origin+'/api/gpt/status',{headers:{Cookie:fixture.sessionCookie}}))).json();assert.equal(status.sharing,true);assert.ok(!JSON.stringify(status).includes('fixture-access'));assert.ok(!JSON.stringify(status).includes('fixture-refresh'));
    const run=await fixture.app.fetch(new Request(origin+'/api/gpt/run',{method:'POST',headers:{Origin:origin,Cookie:fixture.sessionCookie,'Content-Type':'application/json'},body:JSON.stringify({stage:'draft',model:'fixture-model',context:{passage:'시편 1편'}})}));assert.equal(run.status,200);const body=await run.json();assert.equal(body.completed,true);assert.equal(body.billing,'chatgpt_plan');
    const upstream=fixture.calls.find(c=>c.address.endsWith('/responses'));assert.equal(upstream.options.headers.Authorization,'Bearer fixture-access');assert.equal(JSON.parse(upstream.options.body).store,false);assert.ok(!JSON.stringify([...fixture.store.data.values()]).includes('fixture-refresh'));
  }finally{fixture.restore();}
});
test('로그인만 승인되고 Plus 권한이 없으면 생성을 실행하지 않는다',async()=>{
  const fixture=await signInFixture({sharing:false});try{const r=await fixture.app.fetch(new Request(origin+'/api/gpt/run',{method:'POST',headers:{Origin:origin,Cookie:fixture.sessionCookie}}));assert.equal(r.status,403);assert.equal((await r.json()).error,'plan_permission_required');assert.ok(!fixture.calls.some(c=>c.address.endsWith('/responses')));}finally{fixture.restore();}
});
test('만료 보관 자료를 삭제하고 갱신 잠금으로 동일 세션 요청을 직렬화한다',async()=>{
  const store=storage(),app=new PlusSessions({storage:store},env());await app.save('expired',{secret:'fixture'},Date.now()-1);assert.equal(await app.read('expired'),null);assert.equal(store.data.size,0);
  const order=[];await Promise.all([app.locked('a',async()=>{order.push(1);await new Promise(r=>setTimeout(r,10));order.push(2);}),app.locked('a',async()=>order.push(3))]);assert.deepEqual(order,[1,2,3]);
});
test('큰 원문 요청은 생성 전에 중단하고 준비 화면의 연구·형식 입력을 전달한다',async()=>{
  const context={passage:'시편 1편',translation:'개역개정',sermonStyle:'강해설교',series:'시험 회차',narrative:'문학적 흐름 메모',theology:'신학적 검토 메모'};
  const sent=JSON.parse(generationBody({stage:'draft',model:'fixture-model',context}).input[0].content);
  for(const [key,value] of Object.entries(context))assert.equal(sent[key],value);
  const fixture=await signInFixture();try{const response=await fixture.app.fetch(new Request(origin+'/api/gpt/run',{method:'POST',headers:{Origin:origin,Cookie:fixture.sessionCookie,'Content-Type':'application/json'},body:'a'.repeat(200001)}));assert.equal(response.status,413);assert.ok(!fixture.calls.some(c=>c.address.endsWith('/responses')));}finally{fixture.restore();}
});
