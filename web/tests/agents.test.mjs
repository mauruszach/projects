import test from 'node:test';
import assert from 'node:assert/strict';
import {AGENT_SYSTEM,buildAgentStepRequest,validateAgentStep} from '../lib/agents.mjs';
import {askClaude} from '../lib/claude.mjs';

const base={event_id:'e1',event_code:'043',title:'Consultation',goldstein_scale:2.8,timestamp:'2026-09-05T12:00:00Z',actor1:{code:'USA',name:'United States'},actor2:{code:'RUS',name:'Russia'},location:{name:'Geneva'}};
const history=[{event_id:'e0',event_code:'010',goldstein_scale:0,timestamp:'2026-09-05T11:00:00Z',actor1:{code:'USA'},actor2:{code:'RUS'}}];

const validStep={
 actor1_options:['cooperate','signal'],
 actor2_options:['cooperate','escalate'],
 payoff_matrix:[[[3,3],[1,-2]],[[-2,1],[-4,-4]]],
 equilibrium_note:'Mutual cooperation is the best response to itself; no incentive to deviate given the matrix above.',
 chosen_actor1_action:'cooperate',
 chosen_actor2_action:'cooperate',
 event_title:'Scenario: reciprocal consultation',
 event_code:'COOPERATE',
 goldstein_scale:2.5,
 rationale:'Given the payoff matrix, mutual cooperation dominates for both actors. This is a hypothetical assumption, not a prediction.'
};

test('system prompt demands an explicit payoff model and equilibrium reasoning before a choice',()=>{
 assert.match(AGENT_SYSTEM,/payoff matrix/i);
 assert.match(AGENT_SYSTEM,/best response or equilibrium/i);
 assert.match(AGENT_SYSTEM,/hypothetical/i);
 assert.match(AGENT_SYSTEM,/never describe this as a forecast/i);
});

test('buildAgentStepRequest asks for structured JSON output with a schema',()=>{
 const {messages,system,extra}=buildAgentStepRequest({base,history,strategy:'cooperation'});
 assert.equal(system,AGENT_SYSTEM);
 assert.equal(messages.length,1);
 const payload=JSON.parse(messages[0].content);
 assert.equal(payload.base_event.event_id,'e1');
 assert.equal(payload.recent_history.length,1);
 assert.equal(extra.output_config.format.type,'json_schema');
 assert.ok(extra.output_config.format.schema.required.includes('payoff_matrix'));
});

test('buildAgentStepRequest bounds history to the most recent 12 events',()=>{
 const long=Array.from({length:20},(_,i)=>({event_id:`h${i}`,event_code:'010',goldstein_scale:0,timestamp:'2026-09-05T00:00:00Z',actor1:null,actor2:null}));
 const {messages}=buildAgentStepRequest({base,history:long,strategy:'alternating'});
 const payload=JSON.parse(messages[0].content);
 assert.equal(payload.recent_history.length,12);
});

test('validateAgentStep accepts a well-formed response',()=>{
 const result=validateAgentStep(JSON.stringify(validStep));
 assert.equal(result.chosen_actor1_action,'cooperate');
 assert.equal(result.payoff_matrix.length,2);
});

test('validateAgentStep rejects invalid JSON',()=>{
 assert.throws(()=>validateAgentStep('not json'),/invalid JSON/);
});

test('validateAgentStep rejects a chosen action outside the stated options',()=>{
 const bad={...validStep,chosen_actor1_action:'invade'};
 assert.throws(()=>validateAgentStep(JSON.stringify(bad)),/not one of the stated options/);
});

test('validateAgentStep rejects a malformed payoff matrix',()=>{
 const bad={...validStep,payoff_matrix:[[[3,3]]]};
 assert.throws(()=>validateAgentStep(JSON.stringify(bad)),/Malformed payoff matrix/);
});

test('validateAgentStep rejects an out-of-range Goldstein estimate',()=>{
 const bad={...validStep,goldstein_scale:15};
 assert.throws(()=>validateAgentStep(JSON.stringify(bad)),/Invalid Goldstein estimate/);
});

test('agent-step request reuses the retry/cache-safe askClaude transport (mocked, no live call)',async()=>{
 let calls=0;
 const {messages,system,extra}=buildAgentStepRequest({base,history,strategy:'escalation'});
 const result=await askClaude({key:'test-key',messages,system,extra,fetcher:async(url,request)=>{
  calls++;
  const body=JSON.parse(request.body);
  assert.equal(body.output_config.format.type,'json_schema');
  assert.equal(body.thinking.type,'adaptive');
  return Response.json({content:[{type:'text',text:JSON.stringify(validStep)}],stop_reason:'end_turn'});
 }});
 assert.equal(calls,1);
 const step=validateAgentStep(result.text);
 assert.equal(step.chosen_actor2_action,'cooperate');
});
