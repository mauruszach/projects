export type Actor={code:string;name:string;actor_type?:string};
export type PayoffCell=[number,number];
export type AgentStep={actor1_options:string[];actor2_options:string[];payoff_matrix:PayoffCell[][];equilibrium_note:string;chosen_actor1_action:string;chosen_actor2_action:string};
export type WorldEvent={event_id:string;event_code:string;title?:string;goldstein_scale:number;avg_tone:number;timestamp:string;source_url:string;actor1:Actor|null;actor2:Actor|null;location:{name:string}|null;provenance?:'demo'|'recorded'|'simulated';parent_event_id?:string;rationale?:string;agent_step?:AgentStep};
import {DEMO as sample,TYPES as names} from './simulation.mjs';
export const DEMO=sample as WorldEvent[];
export const TYPES=names as Record<string,string>;
