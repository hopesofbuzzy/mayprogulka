import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runPreflight, contractDiff, compareContract } from './live-api-preflight.mjs';
const contract = JSON.parse(await readFile(new URL('../../contracts/openapi.current.json', import.meta.url), 'utf8'));
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const routes = { routes: [{ id: 12, name: 'Synthetic', year: 2026, distance: 12, is_active: true }] };
function harness(handler, origin = 'http://127.0.0.1:8000') {
  const calls = [], logs = [];
  return { calls, logs, run: () => runPreflight({ origin, contract, log: line => logs.push(line), fetchImpl: async (url, options) => { calls.push({ path: url.pathname, options }); return handler(url.pathname); } }) };
}
test('missing origin is NOT_RUN, nonzero, and never calls fetch', async () => {
  const probe = harness(() => { throw new Error('must not fetch'); }, '');
  const result = await probe.run(); assert.equal(result.exitCode, 2); assert.equal(result.results[0].status, 'NOT_RUN'); assert.equal(probe.calls.length, 0);
});
for (const origin of ['https://user:pass@example.test', 'https://example.test/path', 'https://example.test/?secret=value', 'file:///tmp', ' https://example.test']) {
  test('unsafe origin is blocked before network: ' + origin.split(':')[0], async () => {
    const probe = harness(() => json(routes), origin); const result = await probe.run();
    assert.equal(result.results[0].status, 'BLOCKED'); assert.equal(probe.calls.length, 0);
    assert(!probe.logs.join('').includes('secret=value')); assert(!probe.logs.join('').includes('user:pass'));
  });
}
test('only two GETs with no credentials/retry; valid live schema and routes pass independently', async () => {
  const probe = harness(path => json(path === '/openapi.json' ? contract : routes));
  const result = await probe.run(); assert.equal(result.exitCode, 0);
  assert.deepEqual(probe.calls.map(call => call.path), ['/openapi.json', '/api/v1/routes']);
  for (const { options } of probe.calls) { assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'manual'); assert.equal(options.credentials, 'omit'); assert.equal(options.headers.Authorization, undefined); }
  assert(result.results.every(item => item.status === 'PASS_LIVE'));
  assert(!probe.logs.join('').includes('Synthetic'));
});
test('unreachable backend is not PASS and does not retry', async () => {
  const probe = harness(() => { throw new TypeError('private connection diagnostic'); }); const result = await probe.run();
  assert.equal(result.exitCode, 1); assert.equal(probe.calls.length, 2); assert(result.results.every(item => item.status === 'UNREACHABLE')); assert(!probe.logs.join('').includes('private'));
});
test('redirect is blocked without following Location', async () => {
  const probe = harness(() => new Response(null, { status: 302, headers: { Location: 'https://external.example/secret' } }));
  const result = await probe.run(); assert(result.results.every(item => item.status === 'BLOCKED')); assert.equal(probe.calls.length, 2); assert(!probe.logs.join('').includes('external'));
});
for (const [label, reply] of [
  ['HTML fallback', () => new Response('<html>private</html>', { headers: { 'Content-Type': 'text/html' } })],
  ['malformed JSON', () => new Response('{private', { headers: { 'Content-Type': 'application/json' } })],
  ['500', () => new Response('private', { status: 500 })],
]) test(label + ' is not API success and body is never logged', async () => {
  const probe = harness(reply); const result = await probe.run();
  assert.equal(result.exitCode, 1); assert(result.results.every(item => item.status === 'FAIL_LIVE')); assert(!probe.logs.join('').includes('private'));
});
test('missing OpenAPI is NOT_RUN even if routes passes; no claim about other operations', async () => {
  const probe = harness(path => path === '/openapi.json' ? new Response(null, { status: 404 }) : json(routes));
  const result = await probe.run(); assert.equal(result.exitCode, 1); assert.deepEqual(result.results.map(item => item.status), ['NOT_RUN', 'PASS_LIVE']);
});
test('wrong routes shape/type is a contract mismatch, not an empty list', async () => {
  const probe = harness(path => json(path === '/openapi.json' ? contract : { routes: [{ ...routes.routes[0], is_active: 'yes' }] }));
  const result = await probe.run(); assert.equal(result.results[1].status, 'CONTRACT_MISMATCH');
});
test('reports removed/added operations and schema/security changes without printing payload', () => {
  const changed = structuredClone(contract);
  delete changed.paths['/api/v1/participants/my'];
  changed.paths['/api/v1/synthetic'] = { get: {} };
  changed.components.schemas.PaymentResponse.required = ['status'];
  changed.paths['/api/v1/participants/{participant_id}/pay'].post.security = [];
  const diff = contractDiff(contract, changed);
  assert(diff.some(line => line === 'missing GET /api/v1/participants/my'));
  assert.deepEqual(compareContract(contract, changed).added, ['GET /api/v1/synthetic']);
  assert(diff.some(line => line.includes('schema PaymentResponse')));
  assert(diff.some(line => line.includes('security differs')));
});

const scans = ['/api/v1/scans', '/api/v1/scans/batch', '/api/v1/scans/upload-file', '/api/v1/scans/self'];
function additive() {
  const value = structuredClone(contract);
  for (const path of scans) value.paths[path] = { post: { responses: { 200: { description: 'Synthetic extra operation' } } } };
  value.components.schemas.SyntheticExtraScan = { type: 'object' };
  return value;
}
test('22 to 26 is compatible with named extras; no scan request is made', async () => {
  const actual = additive(), result = compareContract(contract, actual);
  assert.equal(result.status, 'COMPATIBLE_WITH_EXTRAS'); assert.equal(result.paths, 24); assert.equal(result.operations, 26);
  assert.deepEqual(result.added, scans.map(path => `POST ${path}`).sort()); assert.deepEqual(result.changed, []); assert.deepEqual(result.missing, []);
  assert.deepEqual(contractDiff(contract, actual), []);
  const probe = harness(path => json(path === '/openapi.json' ? actual : routes)); const run = await probe.run();
  assert.equal(run.exitCode, 0); assert.equal(run.results[0].status, 'COMPATIBLE_WITH_EXTRAS'); assert.equal(run.results[1].status, 'PASS_LIVE');
  assert.deepEqual(probe.calls.map(call => call.path), ['/openapi.json', '/api/v1/routes']);
});
test('all 22 known operations remain required even when backend adds methods', () => {
  for (const [path, item] of Object.entries(contract.paths)) for (const method of Object.keys(item).filter(key => ['get','post','put','delete'].includes(key))) {
    const changed = additive(); delete changed.paths[path][method];
    const result = compareContract(contract, changed); assert.equal(result.status, 'CONTRACT_MISMATCH'); assert(result.missing.includes(`${method.toUpperCase()} ${path}`));
  }
});
for (const field of ['requestBody', 'responses', 'parameters', 'security']) test(`changes to ${field} on any known operation fail, including non-P0`, () => {
  for (const [path, item] of Object.entries(contract.paths)) for (const method of Object.keys(item).filter(key => ['get','post','put','delete'].includes(key))) {
    const changed = additive(); changed.paths[path][method][field] = field === 'security' ? [{ SyntheticSecurity: [] }] : { syntheticBreakingChange: true };
    assert.equal(compareContract(contract, changed).status, 'CONTRACT_MISMATCH', `${method} ${path} ${field}`);
  }
});
test('every one of 36 known schemas is checked, including a DTO property named description', () => {
  assert.equal(Object.keys(contract.components.schemas).length, 36);
  for (const name of Object.keys(contract.components.schemas)) {
    const changed = additive(); changed.components.schemas[name].type = 'synthetic-invalid-type';
    assert(compareContract(contract, changed).changed.includes(`schema ${name} differs`));
  }
  const changed = additive(); changed.components.schemas.RouteResponse.properties.description = { type: 'integer' };
  assert(compareContract(contract, changed).changed.includes('schema RouteResponse differs'));
});
test('inherited security, path parameters, security scheme and versions cannot change unnoticed', () => {
  for (const mutate of [
    value => { value.security = [{ HTTPBearer: [] }]; },
    value => { value.paths['/api/v1/routes'].parameters = [{ name: 'new_required', in: 'query', required: true, schema: { type: 'string' } }]; },
    value => { value.components.securitySchemes.HTTPBearer.scheme = 'basic'; },
    value => { value.openapi = '3.0.3'; }, value => { value.info.version = '2.0'; },
    value => { value.paths['/api/v1/routes'].get = null; },
  ]) { const changed = additive(); mutate(changed); assert.equal(compareContract(contract, changed).status, 'CONTRACT_MISMATCH'); }
});
test('documentation-only schema changes do not hide structural differences or create false failures', () => {
  const changed = additive(); changed.components.schemas.RouteResponse.description = 'Documentation only';
  changed.paths['/api/v1/routes'].get.responses['200'].description = 'Documentation only';
  assert.equal(compareContract(contract, changed).status, 'COMPATIBLE_WITH_EXTRAS');
});
