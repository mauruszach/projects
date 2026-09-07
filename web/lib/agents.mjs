// Autonomous strategy agent: replaces the old fixed rule engine with a real
// Claude call per step that must show its work -- an explicit payoff matrix
// and the equilibrium/best-response reasoning drawn from it -- before picking
// one hypothetical joint outcome. Never a forecast; always labeled as such.

export const AGENT_STEP_SCHEMA={
 type:'object',
 properties:{
  actor1_options:{type:'array',items:{type:'string'},minItems:2,maxItems:4},
  actor2_options:{type:'array',items:{type:'string'},minItems:2,maxItems:4},
  payoff_matrix:{type:'array',description:'Row i, column j holds [actor1_payoff, actor2_payoff] for (actor1_options[i], actor2_options[j]) on an illustrative -5..5 scale. This is your own strategic estimate, not measured data.',items:{type:'array',items:{type:'array',items:{type:'number'},minItems:2,maxItems:2}}},
  equilibrium_note:{type:'string',description:'Best-response or equilibrium reasoning drawn from the matrix above. State explicitly if no pure-strategy equilibrium exists.'},
  chosen_actor1_action:{type:'string',description:'Must be one of actor1_options.'},
  chosen_actor2_action:{type:'string',description:'Must be one of actor2_options.'},
  event_title:{type:'string'},
  event_code:{type:'string',description:'A short label such as COOPERATE, ESCALATE, SIGNAL, WITHDRAW.'},
  goldstein_scale:{type:'number',minimum:-10,maximum:10},
  rationale:{type:'string',description:'2-4 sentences grounded in the payoff matrix and the supplied history. Must state this is a hypothetical assumption, not a prediction.'}
 },
 required:['actor1_options','actor2_options','payoff_matrix','equilibrium_note','chosen_actor1_action','chosen_actor2_action','event_title','event_code','goldstein_scale','rationale'],
 additionalProperties:false
};

export const AGENT_SYSTEM=`You are a strategy agent inside a transparent geopolitical event simulator. You are given one recorded or previously simulated event linking two actors, plus recent related history. Your task is NOT to predict the future -- it is to construct one explicit, inspectable hypothetical next step using real game-theoretic reasoning.
Work in this order: (1) state 2-4 plausible next actions available to each actor; (2) propose a payoff matrix covering every combination of those actions, as your own illustrative estimate grounded in the supplied history -- label it an assumption, never measured data; (3) identify the best response or equilibrium implied by that matrix, and say explicitly if none exists in pure strategies; (4) choose ONE joint outcome consistent with that reasoning. A requested strategy hint (cooperative, escalatory, or unconstrained) may break a tie between comparable outcomes, but the matrix must still support whatever you choose -- do not pick an outcome the matrix argues against.
Never claim certainty, never describe this as a forecast or prediction, and never invent a source URL. Every step is hypothetical by construction.`;

function historySummary(event){
 return {event_id:event.event_id,event_code:event.event_code,goldstein_scale:event.goldstein_scale,timestamp:event.timestamp,actor1:event.actor1?.code||null,actor2:event.actor2?.code||null};
}

export function buildAgentStepRequest({base,history,strategy}){
 const payload={
  instruction:`Propose the next hypothetical step after the base event below. Strategy hint: ${strategy}.`,
  base_event:{event_id:base.event_id,event_code:base.event_code,title:base.title,goldstein_scale:base.goldstein_scale,timestamp:base.timestamp,actor1:base.actor1,actor2:base.actor2,location:base.location},
  recent_history:history.slice(-12).map(historySummary)
 };
 return {
  messages:[{role:'user',content:JSON.stringify(payload)}],
  system:AGENT_SYSTEM,
  extra:{thinking:{type:'adaptive'},output_config:{effort:'high',format:{type:'json_schema',schema:AGENT_STEP_SCHEMA}}}
 };
}

function truncate(value,max){return typeof value==='string'?value.slice(0,max):''}

export function validateAgentStep(raw){
 let parsed;
 try{parsed=JSON.parse(raw)}catch{throw Error('The agent returned invalid JSON.')}
 const {actor1_options,actor2_options,payoff_matrix,equilibrium_note,chosen_actor1_action,chosen_actor2_action,event_title,event_code,goldstein_scale,rationale}=parsed||{};
 if(!Array.isArray(actor1_options)||!actor1_options.length||!actor1_options.every(a=>typeof a==='string'))throw Error('Missing or invalid actor1 options.');
 if(!Array.isArray(actor2_options)||!actor2_options.length||!actor2_options.every(a=>typeof a==='string'))throw Error('Missing or invalid actor2 options.');
 const validMatrix=Array.isArray(payoff_matrix)&&payoff_matrix.length===actor1_options.length&&payoff_matrix.every(row=>Array.isArray(row)&&row.length===actor2_options.length&&row.every(cell=>Array.isArray(cell)&&cell.length===2&&cell.every(Number.isFinite)));
 if(!validMatrix)throw Error('Malformed payoff matrix.');
 if(typeof equilibrium_note!=='string'||!equilibrium_note.trim())throw Error('Missing equilibrium reasoning.');
 if(!actor1_options.includes(chosen_actor1_action))throw Error('Chosen actor1 action is not one of the stated options.');
 if(!actor2_options.includes(chosen_actor2_action))throw Error('Chosen actor2 action is not one of the stated options.');
 if(!Number.isFinite(goldstein_scale)||goldstein_scale<-10||goldstein_scale>10)throw Error('Invalid Goldstein estimate.');
 if(typeof rationale!=='string'||!rationale.trim())throw Error('Missing rationale.');
 return {
  actor1_options:actor1_options.map(a=>truncate(a,80)),
  actor2_options:actor2_options.map(a=>truncate(a,80)),
  payoff_matrix,
  equilibrium_note:truncate(equilibrium_note,600),
  chosen_actor1_action:truncate(chosen_actor1_action,80),
  chosen_actor2_action:truncate(chosen_actor2_action,80),
  event_title:truncate(event_title||'Simulated step',120),
  event_code:truncate(event_code||'AGENT',20),
  goldstein_scale,
  rationale:truncate(rationale,800)
 };
}
