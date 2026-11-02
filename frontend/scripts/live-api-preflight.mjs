import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const p0 = [
  'POST /api/v1/auth/register', 'POST /api/v1/auth/login', 'GET /api/v1/auth/me',
  'POST /api/v1/participants/register', 'GET /api/v1/participants/my',
  'POST /api/v1/participants/{participant_id}/pay', 'GET /api/v1/routes',
];
const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const operations = schema => Object.entries(schema.paths ?? {}).flatMap(([path, item]) => object(item) ? Object.keys(item).filter(method => methods.has(method)).map(method => `${method.toUpperCase()} ${path}`) : []).sort();
function shape(value) {
  if (Array.isArray(value)) return value.map(shape);
  if (!object(value)) return value;
  return Object.fromEntries(Object.keys(value).filter(key => !['title', 'description', 'summary', 'example', 'examples'].includes(key)).sort().map(key => [key, shape(value[key])]));
}
const same = (left, right) => JSON.stringify(shape(left)) === JSON.stringify(shape(right));
const safeName = value => /^[A-Za-z0-9_{}./ -]+$/.test(value) ? value.slice(0, 180) : '[unprintable metadata]';
export function contractDiff(expected, actual) {
  if (!object(actual) || !object(actual.paths) || !object(actual.info) || !object(actual.components?.schemas)) return ['invalid OpenAPI structure'];
  const differences = [];
  const wanted = operations(expected), got = operations(actual);
  if (actual.openapi !== expected.openapi) differences.push('OpenAPI version differs');
  if (actual.info.version !== expected.info.version) differences.push('API version differs');
  if (Object.keys(actual.paths).length !== Object.keys(expected.paths).length) differences.push(`paths expected=${Object.keys(expected.paths).length} actual=${Object.keys(actual.paths).length}`);
  if (got.length !== wanted.length) differences.push(`operations expected=${wanted.length} actual=${got.length}`);
  for (const operation of wanted.filter(item => !got.includes(item))) differences.push(`missing ${safeName(operation)}`);
  for (const operation of got.filter(item => !wanted.includes(item))) differences.push(`extra ${safeName(operation)}`);
  for (const operation of p0) {
    const [method, path] = operation.split(' ');
    const left = expected.paths[path]?.[method.toLowerCase()], right = actual.paths[path]?.[method.toLowerCase()];
    if (!right) continue; // Already reported as missing.
    for (const field of ['requestBody', 'responses', 'parameters', 'security']) if (!same(left[field], right[field])) differences.push(`${operation}: ${field} differs`);
  }
  const schemas = expected.components.schemas;
  for (const name of Object.keys(schemas)) if (!same(schemas[name], actual.components.schemas[name])) differences.push(`schema ${safeName(name)} differs`);
  return differences;
}
function validRoutes(value) {
  return object(value) && Array.isArray(value.routes) && value.routes.every(route => object(route)
    && Number.isSafeInteger(route.id) && Number.isSafeInteger(route.year)
    && typeof route.name === 'string' && typeof route.distance === 'number' && Number.isFinite(route.distance)
    && typeof route.is_active === 'boolean'
    && ['description', 'map_url'].every(key => route[key] === undefined || route[key] === null || typeof route[key] === 'string'));
}
export async function runPreflight({ origin, fetchImpl = globalThis.fetch, contract, log = console.log } = {}) {
  const results = [];
  const emit = result => { results.push(result); log(JSON.stringify(result)); };
  if (!origin) { emit({ status: 'NOT_RUN', reason: 'Set LIVE_API_ORIGIN explicitly to an approved test API origin.' }); return { exitCode: 2, results }; }
  let base;
  try {
    base = new URL(origin);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/' || origin.trim() !== origin) throw new Error();
  } catch { emit({ status: 'BLOCKED', reason: 'LIVE_API_ORIGIN must be an HTTP(S) origin without path, credentials, query or fragment.' }); return { exitCode: 2, results }; }
  const expected = contract ?? JSON.parse(await readFile(new URL('../../contracts/openapi.current.json', import.meta.url), 'utf8'));
  if (expected.openapi !== '3.1.0' || expected.info.version !== '0.1.0' || Object.keys(expected.paths).length !== 20 || operations(expected).length !== 22 || p0.some(item => !operations(expected).includes(item))) {
    emit({ status: 'CONTRACT_MISMATCH', reason: 'Local contract does not match the documented 20 paths / 22 operations / seven P0 operations.' });
    return { exitCode: 1, results };
  }
  for (const path of ['/openapi.json', '/api/v1/routes']) {
    try {
      const response = await fetchImpl(new URL(path, base.origin), { method: 'GET', redirect: 'manual', credentials: 'omit', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(4_000) });
      if (response.status >= 300 && response.status < 400) { emit({ path, http: response.status, status: 'BLOCKED', reason: 'Redirect refused; no destination followed.' }); continue; }
      if (!response.ok) { emit({ path, http: response.status, status: path === '/openapi.json' && response.status === 404 ? 'NOT_RUN' : 'FAIL_LIVE', reason: 'Expected HTTP 200 JSON.' }); continue; }
      const contentType = response.headers.get('content-type') ?? '';
      if (response.status !== 200 || !/^application\/(?:[\w.-]+\+)?json(?:;|$)/i.test(contentType)) { emit({ path, http: response.status, status: 'FAIL_LIVE', reason: 'Expected HTTP 200 with JSON content type; HTML/SPA fallback is not API success.' }); continue; }
      let value;
      try { value = await response.json(); } catch { emit({ path, http: 200, status: 'FAIL_LIVE', reason: 'Invalid JSON body.' }); continue; }
      if (path === '/openapi.json') {
        const differences = contractDiff(expected, value);
        emit({ path, http: 200, json: true, status: differences.length ? 'CONTRACT_MISMATCH' : 'PASS_LIVE', differences, ...(differences.length ? {} : { paths: 20, operations: 22, p0: 7 }) });
      } else {
        emit({ path, http: 200, json: true, status: validRoutes(value) ? 'PASS_LIVE' : 'CONTRACT_MISMATCH', ...(validRoutes(value) ? { routes: value.routes.length } : { reason: 'Expected routes array with RouteResponse fields/types.' }) });
      }
    } catch { emit({ path, status: 'UNREACHABLE', reason: 'Connection, timeout or response read failed; no retry performed.' }); }
  }
  return { exitCode: results.every(result => result.status === 'PASS_LIVE') ? 0 : 1, results };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = (await runPreflight({ origin: process.env.LIVE_API_ORIGIN })).exitCode; }
  catch { console.error(JSON.stringify({ status: 'BLOCKED', reason: 'Cannot read/validate the tracked local contract.' })); process.exitCode = 1; }
}
