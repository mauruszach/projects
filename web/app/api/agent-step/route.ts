import { NextResponse } from 'next/server';
import { buildAgentStepRequest, validateAgentStep } from '../../../lib/agents.mjs';
import { askClaude } from '../../../lib/claude.mjs';
export const maxDuration=150;

type StepBody={base:unknown;history:unknown;strategy:unknown};

function validateBody(body:StepBody){
 const base=body?.base as {event_id?:unknown;timestamp?:unknown}|undefined;
 if(!base||typeof base.event_id!=='string'||typeof base.timestamp!=='string'||!Number.isFinite(Date.parse(base.timestamp)))throw Error('Invalid base event.');
 if(!Array.isArray(body.history)||body.history.length>50)throw Error('Invalid history.');
 if(!['cooperation','escalation','alternating'].includes(body.strategy as string))throw Error('Invalid strategy.');
 return {base,history:body.history,strategy:body.strategy as 'cooperation'|'escalation'|'alternating'};
}

export async function POST(request:Request){
 const key=request.headers.get('x-anthropic-api-key')?.trim();
 const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
 if(!key||key.length>500)return reply({error:'Supply your own Anthropic API key.'},401);
 const raw=await request.text();
 if(raw.length>200000)return reply({error:'This request is too large.'},413);
 let input;
 try{input=validateBody(JSON.parse(raw));}catch(e){return reply({error:e instanceof Error?e.message:'Invalid request.'},400)}
 const {messages,system,extra}=buildAgentStepRequest(input);
 try{
  const result=await askClaude({key,messages,system,extra});
  const step=validateAgentStep(result.text);
  return reply({step});
 }catch(e){return reply({error:e instanceof Error?e.message:'Unable to generate a step.'},502)}
}
