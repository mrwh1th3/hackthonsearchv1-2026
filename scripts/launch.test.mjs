import test from 'node:test';
import assert from 'node:assert/strict';
import { assess } from './launch.mjs';

const config = () => ({ schema_version: 1, hackathon_started: true,
  development: { max_parallel_builders: 3, coordinator_model: 'opus', allow_local_implementation: true },
  runtime: { provider: 'pending' }, targets: {}, reported_connections: { verified: false }, authorizations: {} });
const facts = { nodeOk: true, claudeOk: true, headOk: true, kitCommitted: true };

test('inicio sin confirmar bloquea construcción', () => {
  assert.equal(assess({ ...config(), hackathon_started: false }, facts).local_launch_ready, false);
});
test('sin HEAD bloquea worktrees', () => {
  assert.equal(assess(config(), { ...facts, headOk: false }).local_launch_ready, false);
});
test('archivos sin commit bloquean bootstrap', () => {
  assert.equal(assess(config(), { ...facts, kitCommitted: false }).local_launch_ready, false);
});
test('conexiones pendientes no impiden construcción local autorizada', () => {
  const result = assess(config(), facts);
  assert.equal(result.local_launch_ready, true);
  assert.ok(result.pending.length > 0);
});
test('concurrencia y modelos se validan', () => {
  const c = config(); c.development.max_parallel_builders = 99;
  assert.equal(assess(c, facts).local_launch_ready, false);
  c.development.max_parallel_builders = 3; c.development.coordinator_model = '--unsafe';
  assert.equal(assess(c, facts).local_launch_ready, false);
});
test('no acepta truthy string como inicio', () => {
  assert.equal(assess({ ...config(), hackathon_started: 'true' }, facts).local_launch_ready, false);
});
test('proveedor desconocido bloquea', () => {
  const c = config(); c.runtime.provider = 'inventado';
  assert.equal(assess(c, facts).local_launch_ready, false);
});
test('configuración nula se rechaza sin lanzar', () => {
  assert.equal(assess(null, facts).local_launch_ready, false);
});
