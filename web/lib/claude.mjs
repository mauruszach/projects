import { createHmac, randomBytes } from 'node:crypto';
const salt=randomBytes(32);
const cache=new Map();
// Request-scoped credentials are forwarded only to Anthropic and never persisted or logged.
export async function askClaude({key,messages,system,extra={},fetcher=fetch,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 const model=process.env.ANTHROPIC_CHAT_MODEL||'claude-sonnet-4-6';
 const fingerprint=createHmac('sha256',salt).update(JSON.stringify({key,messages,system,model,extra})).digest('hex');
 const cached=cache.get(fingerprint);
 if(fetcher===fetch&&cached&&cached.expires>Date.now())return cached.result;
 for(let attempt=0;attempt<3;attempt++){
  let response;
  try {response=await fetcher('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'content-type':'application/json','anthropic-version':'2023-06-01','x-api-key':key},body:JSON.stringify({model,max_tokens:2200,system,messages,...extra}),signal:AbortSignal.timeout(45000)});}catch{if(attempt<2){await sleep(1000*2**attempt);continue}throw Error('Anthropic could not be reached. Please try again.');}
  if(response.ok){const result=await response.json();const text=result.content?.filter(b=>b.type==='text').map(b=>b.text).join('\n');if(!text)throw Error('No text response was returned.');const answer={text,truncated:result.stop_reason==='max_tokens'};if(fetcher===fetch){if(cache.size>=64)cache.delete(cache.keys().next().value);cache.set(fingerprint,{result:answer,expires:Date.now()+300000})}return answer;}
  if((response.status===429||response.status>=500)&&attempt<2){await sleep(1000*2**attempt);continue}
  if(response.status===401||response.status===403)throw Error('Anthropic rejected this key. Check its validity and permissions.');
  if(response.status===429)throw Error('Anthropic rate limit reached. Please wait before trying again.');
  throw Error('Anthropic could not complete this request. Check your account credits and model access.');
 }
 throw Error('Request could not be completed.');
}
