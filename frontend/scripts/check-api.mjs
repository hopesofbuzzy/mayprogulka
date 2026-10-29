import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import openapiTS, { astToString, COMMENT_HEADER } from 'openapi-typescript';

const contractUrl = new URL('../../contracts/openapi.current.json', import.meta.url);
const schema = JSON.parse(await readFile(contractUrl, 'utf8'));
const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace']);
const paths = Object.entries(schema.paths);
assert.equal(schema.openapi, '3.1.0');
assert.equal(schema.info.version, '0.1.0');
assert.equal(paths.length, 20);
assert.equal(paths.flatMap(([, item]) => Object.keys(item).filter((key) => methods.has(key))).length, 22);
assert(paths.every(([path]) => path.startsWith('/api/v1/') && !path.includes('/api/v1/api/v1')));
const generated = COMMENT_HEADER + astToString(await openapiTS(contractUrl));
assert.equal(await readFile(new URL('../src/shared/api/schema.d.ts', import.meta.url), 'utf8'), generated);
console.log('OpenAPI 3.1.0 / API 0.1.0: 20 paths, 22 operations; generated types reproduce exactly.');
