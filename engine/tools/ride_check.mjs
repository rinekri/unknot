// U14 self-check of the on-demand lift (level.js rideStep): node tools/ride_check.mjs
import assert from 'node:assert';
import { rideStep, RIDE_SETTLE, RIDE_BACK } from '../src/systems/level.js';
const k = { m: { period: 5 } }, dt = 1 / 60, run = (on, s) => { for (let i = 0; i < Math.round(s / dt); i++) rideStep(k, on, dt); };
run(false, 5); assert.equal(k.u, 0, 'waits at the bottom');
run(true, RIDE_SETTLE - 0.1); assert.equal(k.u, 0, 'settle first');
run(true, 3); assert.equal(k.u, 1, 'carries the hero up');
run(true, 10); assert.equal(k.u, 1, 'waits at the top while he stands on it');
run(false, RIDE_BACK - 0.2); assert.equal(k.u, 1, 'still there just after he leaves');
run(false, 3); assert.equal(k.u, 0, 'goes home');
run(true, 3.2); run(false, 0.5); run(true, 3.2); assert.equal(k.u, 0, 'off and on again at the top: rides down');
console.log('ride_check ok');
