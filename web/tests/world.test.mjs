import test from 'node:test';
import assert from 'node:assert/strict';
import {DEMO} from '../lib/simulation.mjs';
test('starting graph has diverse actors and unlinked events',()=>{assert.equal(DEMO.length,144);assert.equal(new Set(DEMO.map(e=>e.event_id)).size,144);assert.ok(DEMO.some(e=>!e.actor1&&!e.actor2));const types=new Set(DEMO.flatMap(e=>[e.actor1?.actor_type,e.actor2?.actor_type]));assert.ok(types.has('country')&&types.has('org')&&types.has('person'));assert.ok(DEMO.every(e=>e.provenance==='demo'))});
