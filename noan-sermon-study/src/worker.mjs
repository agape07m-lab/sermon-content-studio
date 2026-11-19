import {PlanError,PLAN_SCOPE,OPENAI_ORIGIN,API_ORIGIN,requirePlanConfig,random,digest,seal,unseal,verifyIdentity,verifyOrigin,generationBody,completedText} from './plus-core.mjs';
const TTL=7*86400000;
const HEADERS={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(value,status=200,extra={})=>new Response(JSON.stringify(value),{status,headers:{...HEADERS,'Content-Type':'application/json; charset=utf-8',...extra}});
const cookie=(name,value,age)=>`${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`;
const cookieValue=(request,name)=>{const value=request.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)||'';return /^[\w-]{43}$/.test(value)?value:'';};
const notice=(message,status=400)=>new Response(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ChatGPT 연결</title><p>${message}</p><p><a href="/">설교연구실로 돌아가기</a></p></html>`,{status,headers:{...HEADERS,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; base-uri 'none'; frame-ancestors 'none'"}});
export default {async fetch(request,env){const path=new URL(request.url).pathname;if(path.startsWith('/api/gpt/')||path.startsWith('/auth/openai/')){
  if(!env.PLUS_SESSIONS)return json({error:'registration_pending',message:'Plus 연결 준비 중입니다. 기존 원고는 계속 작성하고 보관할 수 있습니다.'},503);
  return env.PLUS_SESSIONS.get(env.PLUS_SESSIONS.idFromName('plus-sessions-v1')).fetch(request);
}return env.ASSETS.fetch(request);}};
export class PlusSessions {
  constructor(ctx,env){this.ctx=ctx;this.env=env;this.locks=new Map();this.connectionAttempts=[];}
  async save(key,value,expiresAt){await this.ctx.storage.put(key,{expiresAt,box:await seal(value,this.env.PLUS_STORAGE_KEY)});await this.ctx.storage.setAlarm(Date.now()+3600000);}
  async read(key){const record=await this.ctx.storage.get(key);if(!record)return null;if(record.expiresAt<=Date.now()){await this.ctx.storage.delete(key);return null;}return unseal(record.box,this.env.PLUS_STORAGE_KEY);}
  async alarm(){const rows=await this.ctx.storage.list();for(const [key,row] of rows)if(row.expiresAt<=Date.now())await this.ctx.storage.delete(key);if(rows.size)await this.ctx.storage.setAlarm(Date.now()+3600000);}
  async locked(key,fn){const old=this.locks.get(key)||Promise.resolve();let release;const next=new Promise(resolve=>release=resolve);this.locks.set(key,next);await old.catch(()=>{});try{return await fn();}finally{release();if(this.locks.get(key)===next)this.locks.delete(key);}}
  async fetch(request){
    const path=new URL(request.url).pathname;
    try{
      const origin=requirePlanConfig(this.env);
      if(new URL(request.url).origin!==origin)throw new PlanError('forbidden','연결 주소를 확인해 주세요.',403);
      if(request.method==='POST')verifyOrigin(request,origin);
      if(path==='/api/gpt/connect'&&request.method==='GET')return await this.connect();
      if(path==='/auth/openai/callback'&&request.method==='GET')return await this.callback(request);
      const sid=cookieValue(request,'__Host-noan_gpt');const key=sid?'session:'+await digest(sid):'';
      if(path==='/api/gpt/status'&&request.method==='GET'){
        const session=key?await this.read(key):null;return json({state:session?'connected':'disconnected',sharing:Boolean(session?.scopes.includes(PLAN_SCOPE)),account:session?{name:session.name,email:session.email}:null});
      }
      if(!key)throw new PlanError('sign_in_required','먼저 ChatGPT 계정을 연결해 주세요.',401);
      return await this.locked(key,async()=>{
        const session=await this.read(key);if(!session)throw new PlanError('sign_in_required','연결이 만료되었습니다. 다시 연결해 주세요.',401);
        if(path==='/api/gpt/logout'&&request.method==='POST')return this.logout(key,session);
        if(!session.scopes.includes(PLAN_SCOPE))throw new PlanError('plan_permission_required','ChatGPT 로그인과 별도로 Plus 사용 권한 승인이 필요합니다.',403);
        const current=await this.renew(key,session);
        if(!current.scopes.includes(PLAN_SCOPE))throw new PlanError('plan_permission_required','Plus 사용 권한을 확인하지 못했습니다. 다시 연결해 주세요.',403);
        if(path==='/api/gpt/models'&&request.method==='GET')return json({models:await this.models(current.access_token)});
        if(path==='/api/gpt/run'&&request.method==='POST')return this.run(request,key,current);
        throw new PlanError('not_found','지원하지 않는 요청입니다.',404);
      });
    }catch(e){const error=e instanceof PlanError?e:new PlanError('connection_error','요청을 완료하지 못했습니다. 연결 상태를 다시 확인해 주세요.',502);if(path==='/auth/openai/callback')return notice(error.message,error.status);return json({error:error.code,message:error.message},error.status);}
  }
  async connect(){
    this.connectionAttempts=this.connectionAttempts.filter(t=>t>Date.now()-60000);if(this.connectionAttempts.length>=20)throw new PlanError('slow_down','잠시 후 다시 연결해 주세요.',429);this.connectionAttempts.push(Date.now());
    const tx=random(),state=random(),nonce=random(),verifier=random();await this.save('tx:'+await digest(tx),{state,nonce,verifier},Date.now()+600000);
    const url=new URL('/api/accounts/authorize',OPENAI_ORIGIN);url.search=new URLSearchParams({client_id:this.env.PLUS_CLIENT_ID,response_type:'code',redirect_uri:this.env.PUBLIC_ORIGIN+'/auth/openai/callback',scope:'openid profile email offline_access resource.invoke '+PLAN_SCOPE,resource:API_ORIGIN+'/v1',state,nonce,code_challenge_method:'S256',code_challenge:await digest(verifier)}).toString();
    return new Response(null,{status:302,headers:{...HEADERS,Location:url.href,'Set-Cookie':cookie('__Host-noan_gpt_tx',tx,600)}});
  }
  async callback(request){
    const tx=cookieValue(request,'__Host-noan_gpt_tx');const key='tx:'+await digest(tx);const pending=tx?await this.read(key):null;const url=new URL(request.url);
    if(!pending||url.searchParams.get('state')!==pending.state)throw new PlanError('invalid_state','로그인을 확인하지 못했습니다. 앱에서 다시 연결해 주세요.',401);
    await this.ctx.storage.delete(key);
    if(url.searchParams.has('error'))throw new PlanError('sign_in_cancelled','ChatGPT 연결을 승인하지 않았습니다. 기존 원고는 그대로 유지됩니다.',401);
    const code=url.searchParams.get('code');if(!code||code.length>4096)throw new PlanError('invalid_callback','로그인 응답을 확인하지 못했습니다.',401);
    const token=await this.token({grant_type:'authorization_code',client_id:this.env.PLUS_CLIENT_ID,code,code_verifier:pending.verifier,redirect_uri:this.env.PUBLIC_ORIGIN+'/auth/openai/callback',resource:API_ORIGIN+'/v1'});
    if(typeof token.id_token!=='string')throw new PlanError('invalid_identity','로그인 응답을 확인하지 못했습니다.',401);
    const jwksResponse=await fetch(OPENAI_ORIGIN+'/.well-known/jwks.json',{signal:AbortSignal.timeout(15000)});if(!jwksResponse.ok)throw Error('JWKS unavailable');
    const identity=await verifyIdentity(token.id_token,await jwksResponse.json(),{clientId:this.env.PLUS_CLIENT_ID,nonce:pending.nonce});
    const scopes=typeof token.scope==='string'?token.scope.split(/\s+/):[];
    // Identity-only login cannot activate drafting. Never upgrade scopes locally.
    const sid=random();await this.save('session:'+await digest(sid),{...identity,scopes,access_token:token.access_token,refresh_token:token.refresh_token||'',expiresAt:Date.now()+token.expires_in*1000,sessionUntil:Date.now()+TTL,runTimes:[]},Date.now()+TTL);
    const headers=new Headers({...HEADERS,Location:this.env.PUBLIC_ORIGIN+'/#plus-connected'});headers.append('Set-Cookie',cookie('__Host-noan_gpt',sid,TTL/1000));headers.append('Set-Cookie',cookie('__Host-noan_gpt_tx','',0));return new Response(null,{status:303,headers});
  }
  async token(fields){
    const response=await fetch(OPENAI_ORIGIN+'/api/accounts/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(fields),signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new PlanError(response.status===400?'reconnect_required':'connection_unavailable','로그인을 갱신하지 못했습니다. 다시 연결해 주세요.',401);
    const data=await response.json();if(typeof data.access_token!=='string'||!data.access_token||!Number.isFinite(data.expires_in)||data.expires_in<=0||data.token_type?.toLowerCase()!=='bearer')throw new PlanError('invalid_token_response','로그인 응답을 확인하지 못했습니다.',401);return data;
  }
  async renew(key,session){
    if(session.expiresAt>Date.now()+60000)return session;
    if(!session.refresh_token)throw new PlanError('reconnect_required','연결이 만료되었습니다. 다시 연결해 주세요.',401);
    const token=await this.token({grant_type:'refresh_token',client_id:this.env.PLUS_CLIENT_ID,refresh_token:session.refresh_token,resource:API_ORIGIN+'/v1'});
    const next={...session,access_token:token.access_token,refresh_token:token.refresh_token||session.refresh_token,expiresAt:Date.now()+token.expires_in*1000,scopes:typeof token.scope==='string'?token.scope.split(/\s+/):session.scopes};
    await this.save(key,next,next.sessionUntil);return next;
  }
  async models(accessToken){const response=await fetch(API_ORIGIN+'/v1/models',{headers:{Authorization:'Bearer '+accessToken},signal:AbortSignal.timeout(20000)});if(!response.ok)throw new PlanError('models_unavailable','사용 가능한 모델을 불러오지 못했습니다.',502);const raw=await response.json();if(!Array.isArray(raw.models))throw new PlanError('models_unavailable','모델 목록 형식을 확인하지 못했습니다.',502);return raw.models.filter(m=>m.visibility==='list'&&typeof m.slug==='string').map(m=>({id:m.slug,name:typeof m.display_name==='string'?m.display_name:m.slug}));}
  async run(request,key,session){
    if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw new PlanError('invalid_input','입력 형식을 확인해 주세요.');
    const reader=request.body?.getReader();let raw='',bytes=0;const decoder=new TextDecoder();
    if(reader)try{while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>200000){await reader.cancel();throw new PlanError('input_too_large','입력이 너무 깁니다.',413);}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();}finally{reader.releaseLock();}
    let input;try{input=JSON.parse(raw);}catch{throw new PlanError('invalid_input','입력 형식을 확인해 주세요.');}
    const body=generationBody(input),models=await this.models(session.access_token);if(!models.some(m=>m.id===body.model))throw new PlanError('invalid_model','연결된 계정에서 사용할 수 있는 모델을 선택해 주세요.');
    session.runTimes=session.runTimes.filter(t=>t>Date.now()-3600000);if(session.runTimes.length>=30)throw new PlanError('slow_down','이 앱에서 작업을 많이 요청했습니다. 잠시 후 다시 시도해 주세요.',429);session.runTimes.push(Date.now());await this.save(key,session,session.sessionUntil);
    const response=await fetch(API_ORIGIN+'/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.any([request.signal,AbortSignal.timeout(240000)])});
    const content=await completedText(response);return json({stage:input.stage,content,completed:true,billing:'chatgpt_plan'});
  }
  async logout(key,session){
    let revoked=!session.refresh_token;
    if(session.refresh_token){try{const response=await fetch(OPENAI_ORIGIN+'/.well-known/openid-configuration',{signal:AbortSignal.timeout(15000)});const config=await response.json();const endpoint=new URL(config.revocation_endpoint);if(endpoint.origin!==OPENAI_ORIGIN)throw Error();const revocation=await fetch(endpoint.href,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:session.refresh_token,token_type_hint:'refresh_token',client_id:this.env.PLUS_CLIENT_ID}),signal:AbortSignal.timeout(15000)});revoked=revocation.status===200;}catch{revoked=false;}}
    await this.ctx.storage.delete(key);return json({signedOut:true,revoked,message:revoked?'연결을 해제했습니다.':'이 기기의 연결을 해제했습니다. ChatGPT 설정에서도 앱 연결을 확인해 주세요.'},200,{'Set-Cookie':cookie('__Host-noan_gpt','',0)});
  }
}
