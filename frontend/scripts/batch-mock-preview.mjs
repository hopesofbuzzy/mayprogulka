// Explicit, isolated manual preview. One Vite server, no FastAPI/proxy/network fallback.
import { createServer } from 'vite';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

if (process.env.VITE_ENABLE_CHECKPOINT_BATCH !== 'true') throw new Error('Explicit VITE_ENABLE_CHECKPOINT_BATCH=true is required for mock preview.');
const root = fileURLToPath(new URL('../', import.meta.url));
const token = randomUUID();
const routes = [{ id: 12, name: 'Синтетическая лесная тропа', year: 2026, distance: 12, is_active: true, description: 'Изолированный просмотр TASK-10. Все данные вымышлены.' }];
let checkpoints = [{ id: 1201, route_id: 12, name: 'Синтетический старт', address: 'Тестовый адрес', coordinates: '000 opaque; mock', order: 0, is_start: true, is_finish: false }];
let nextId = 5000;
const server = await createServer({ root, mode: 'e2e', server: { host: '127.0.0.1', port: 4180, strictPort: true, proxy: {} }, plugins: [{
  name: 'isolated-checkpoint-preview',
  transformIndexHtml(html) {
    return html.replace('<body>', '<body><aside style="padding:12px;background:#fff3df;color:#174834;font:14px sans-serif;line-height:1.5">Изолированный MOCK-просмотр TASK-10. Без FastAPI. Вход: preview-admin / preview-only. В названии строки [partial] моделирует частичный ответ, [unknown] — HTTP 408. Остальные изменяющие операции отключены. Данные сбрасываются при перезапуске процесса.</aside>');
  },
  configureServer(vite) {
    vite.middlewares.use(async (request, response, next) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1:4180');
      if (!url.pathname.startsWith('/api/')) return next();
      const reply = (body, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body)); };
      try {
        if (request.method === 'GET' && !request.headers.authorization) {
          if (url.pathname === '/api/v1/routes' && !url.search) return reply({ routes });
          if (url.pathname === '/api/v1/checkpoints' && url.search === '?route_id=12') return reply({ checkpoints });
        }
        let source = '';
        for await (const part of request) { source += part; if (source.length > 1_000_000) return reply({ detail: 'Mock preview request too large' }, 413); }
        const body = source ? JSON.parse(source) : null;
        if (request.method === 'POST' && url.pathname === '/api/v1/auth/login' && !url.search && body?.username === 'preview-admin' && body?.password === 'preview-only') return reply({ access_token: token, user_id: 7, role: 'admin' });
        if (request.method === 'POST' && url.pathname === '/api/v1/admin/checkpoints/batch' && !url.search) {
          if (request.headers.authorization !== `Bearer ${token}`) return reply({}, 403);
          const fields = ['address', 'coordinates', 'is_finish', 'is_start', 'name', 'order', 'route_id'];
          if (JSON.stringify(Object.keys(body ?? {}).sort()) !== JSON.stringify(['checkpoints', 'route_id']) || body.route_id !== 12 || !Array.isArray(body.checkpoints) || !body.checkpoints.length
            || body.checkpoints.some(row => JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(fields) || row.route_id !== 12 || !Number.isSafeInteger(row.order) || ['name', 'address', 'coordinates'].some(field => typeof row[field] !== 'string' || !row[field].trim()) || ['is_start', 'is_finish'].some(field => typeof row[field] !== 'boolean'))) return reply({ detail: 'Invalid synthetic batch DTO' }, 422);
          if (body.checkpoints.some(row => row.name.includes('[unknown]'))) return reply({}, 408);
          const partial = body.checkpoints.some(row => row.name.includes('[partial]'));
          const count = partial ? Math.min(1, body.checkpoints.length) : body.checkpoints.length;
          checkpoints = [...checkpoints, ...body.checkpoints.slice(0, count).map(row => ({ ...row, id: ++nextId }))];
          return reply({ created_count: count, errors: partial ? [{ mock_message: 'Синтетический частичный ответ, соответствие строкам неизвестно.' }] : [] }, 201);
        }
        return reply({ detail: 'Unsupported operation blocked by isolated mock preview' }, 405);
      } catch { return reply({ detail: 'Invalid mock request' }, 400); }
    });
  },
}] });
await server.listen();
server.printUrls();
