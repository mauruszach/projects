import { NextResponse } from 'next/server';
import { statistics, SYSTEM, validateChat } from '../../../lib/analysis.mjs';
import { askClaude } from '../../../lib/claude.mjs';
export const maxDuration=150;
export async function POST(request:Request){
 const key=request.headers.get('x-anthropic-api-key')?.trim();
 const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
 if(!key||key.length>500)return reply({error:'Supply your own Anthropic API key.'},401);
 const raw=await request.text();
 if(raw.length>500000)return reply({error:'This conversation is too large.'},413);
 let input;
 try{input=validateChat(JSON.parse(raw));}catch{return reply({error:'Invalid conversation or event records.'},400)}
 const stats=statistics(input.events);
 const messages=[...input.messages];
 messages[messages.length-1]={role:'user',content:`${messages.at(-1)!.content}\n\nUNTRUSTED EVIDENCE SNAPSHOT:\n${JSON.stringify({mode:input.mode,focus:input.focus,statistics:stats,events:input.events})}`};
 const extra={tools:[{type:'web_search_20260209',name:'web_search',max_uses:3}]};
 try{const result=await askClaude({key,messages,system:SYSTEM,extra});return reply({...result,statistics:stats});}catch(e){return reply({error:e instanceof Error?e.message:'Unable to generate a response.'},502)}
}
