import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveConfig } from 'vite';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
test('normal dev respects explicit dev proxy target; preview never inherits it', async () => {
  const previous = process.env.API_PROXY_TARGET;
  process.env.API_PROXY_TARGET = 'http://127.0.0.1:18000'; // Synthetic configuration value; never contacted.
  try {
    const dev = await resolveConfig({ root, mode: 'development', logLevel: 'silent' }, 'serve');
    assert.equal(dev.server.proxy['/api'].target, 'http://127.0.0.1:18000');
    assert.deepEqual(dev.preview.proxy, {});
    const production = await resolveConfig({ root, mode: 'production', logLevel: 'silent' }, 'build');
    assert.deepEqual(production.preview.proxy, {});
    assert.equal(dev.server.proxy['/api'].changeOrigin, true);
  } finally { if (previous === undefined) delete process.env.API_PROXY_TARGET; else process.env.API_PROXY_TARGET = previous; }
});
test('isolated e2e cannot proxy requests to a backend', async () => {
  const config = await resolveConfig({ root, mode: 'e2e', logLevel: 'silent' }, 'serve');
  assert.deepEqual(config.server.proxy, {});
  assert.deepEqual(config.preview.proxy, {});
});
test('application import graph cannot reach fixtures or a mock preview', async () => {
  const visited = new Set();
  async function visit(file) {
    if (visited.has(file)) return;
    visited.add(file);
    assert.doesNotMatch(file, /[\\/](tests?|scripts)[\\/]|\.(test|spec)\./);
    const text = await readFile(file, 'utf8');
    assert.doesNotMatch(text, /localStorage|sessionStorage|import\.meta\.env\.DEV|setupWorker|mockServiceWorker/);
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const imports = [];
    function walk(node) {
      if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
      if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) imports.push(node.arguments[0].text);
      ts.forEachChild(node, walk);
    }
    walk(source);
    for (const path of imports.filter(path => path.startsWith('.'))) {
      const target = resolve(dirname(file), path);
      const next = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'].map(extension => target + extension).find(candidate => existsSync(candidate));
      assert.ok(next, 'Every local application import resolves');
      if (/\.(ts|tsx)$/.test(next)) await visit(next);
      else assert.doesNotMatch(next, /[\\/](tests?|scripts)[\\/]/);
    }
  }
  await visit(resolve(root, 'src/app/main.tsx'));
  assert.ok(visited.has(resolve(root, 'src/shared/api/client.ts')));
  assert.ok(visited.has(resolve(root, 'src/features/adminCheckpoints/batch/model.ts')));
});
