'use strict';
// No credentials or network writes. The caller publishes after reviewing the output.
const fs=require('node:fs');
const crypto=require('node:crypto');
const Feed=require('../public/feed.js');
function verify(item){
  Feed.validate(item);
  const hash=crypto.createHash('sha256').update(item.content,'utf8').digest('hex');
  if(hash!==item.review.contentSha256)throw new Error('검토한 원문과 현재 원문이 다릅니다.');
}
function prepare(base,candidates,now=new Date().toISOString()){
  candidates.forEach(verify);
  base.items.filter(x=>x.review).forEach(verify);
  const result=Feed.merge(base,candidates,now);
  Feed.parse(result);
  return result;
}
if(require.main===module){
  const [basePath,candidatePath,outPath]=process.argv.slice(2);
  if(!basePath||!candidatePath||!outPath)throw new Error('Usage: node scripts/prepare-feed.cjs base.json reviewed-candidates.json output.json');
  const raw=fs.readFileSync(basePath,'utf8'),base=JSON.parse(raw),candidates=JSON.parse(fs.readFileSync(candidatePath,'utf8'));
  const result=prepare(base,candidates);
  fs.writeFileSync(outPath,result===base?raw:JSON.stringify(result,null,2)+'\n','utf8');
  console.log(JSON.stringify({changed:result!==base,items:result.items.map(x=>({id:x.id,kind:x.kind,date:x.date,sequence:x.sequence,title:x.title}))},null,2));
}
module.exports={prepare,verify};
