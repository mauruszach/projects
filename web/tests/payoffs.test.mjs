import test from 'node:test';
import assert from 'node:assert/strict';
import {pureEquilibria} from '../lib/payoffs.mjs';
test('prisoner dilemma has mutual defection equilibrium',()=>assert.deepEqual(pureEquilibria([[[3,3],[0,5]],[[5,0],[1,1]]]),[[1,1]]));
test('matching pennies has no pure equilibrium',()=>assert.deepEqual(pureEquilibria([[[1,-1],[-1,1]],[[-1,1],[1,-1]]]),[]));
test('ties retain every equilibrium',()=>assert.deepEqual(pureEquilibria([[[0,0],[0,0]],[[0,0],[0,0]]]),[[0,0],[0,1],[1,0],[1,1]]));
test('coordination game retains both equilibria',()=>assert.deepEqual(pureEquilibria([[[2,1],[0,0]],[[0,0],[1,2]]]),[[0,0],[1,1]]));
