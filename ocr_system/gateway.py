import asyncio
import io
import re
from contextlib import asynccontextmanager
from pathlib import Path
from threading import Lock

import httpx
import numpy as np
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, Response
from PIL import Image, ImageOps
from starlette.datastructures import UploadFile
from starlette.formparsers import MultiPartException, MultiPartParser

from .pipeline import FormOCRPipeline, RejectedForm

ROOT = Path(__file__).resolve().parents[1]
HOST = '127.0.0.1'
PORT = 8080
ORIGIN = f'http://{HOST}:{PORT}'
BACKEND = 'http://127.0.0.1:8000'
MAX_FILE = 10 * 1024 * 1024
MAX_UPLOAD = MAX_FILE + 16 * 1024
MAX_PIXELS = 24_000_000
STATIC = {
    'login.html', 'typist_station.html', 'api_config.js', 'typist_ocr.js',
    'mp_toast.js', 'ecosystem_bar.js', 'qrcode.min.js', 'html5-qrcode.min.js',
    'ocr_system/typist-gateway.css',
}
PROXY_ROUTES = {
    ('POST', '/api/v1/auth/login'), ('POST', '/api/v1/auth/register'),
    ('GET', '/api/v1/auth/me'), ('GET', '/api/v1/routes'),
    ('POST', '/api/v1/typist/paper-form'), ('POST', '/api/v1/typist/match'),
    ('GET', '/api/v1/typist/unlinked'),
}
CSP = ("default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'; "
       "img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
       "font-src 'self' https://fonts.gstatic.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
PIPELINE = None
MODEL_FAILED = False
INFERENCE = Lock()


@asynccontextmanager
async def lifespan(app):
    async with httpx.AsyncClient(base_url=BACKEND, timeout=10, trust_env=False) as client:
        app.state.backend = client
        yield


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None, redirect_slashes=False)


@app.middleware('http')
async def loopback_only(request, call_next):
    if request.headers.get('host') != f'{HOST}:{PORT}':
        return Response(status_code=400)
    if request.headers.get('origin') not in (None, ORIGIN):
        return Response(status_code=403)
    response = await call_next(request)
    response.headers['Cache-Control'] = 'no-store'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['Content-Security-Policy'] = CSP
    response.headers['X-Content-Type-Options'] = 'nosniff'
    return response


async def limited_stream(request, limit):
    length = request.headers.get('content-length')
    if length is not None and (not length.isascii() or not length.isdecimal() or len(length) > 12 or int(length) > limit):
        raise HTTPException(413, 'Превышен допустимый размер запроса.')
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > limit:
            # MultiPartParser closes partially parsed files for this exception.
            raise MultiPartException('request too large')
        yield chunk


class MemoryMultipart(MultiPartParser):
    spool_max_size = MAX_UPLOAD


async def backend_request(request, method, path, **kwargs):
    try:
        return await request.app.state.backend.request(method, path, **kwargs)
    except httpx.TimeoutException:
        raise HTTPException(504, 'Бэкенд не ответил вовремя.') from None
    except httpx.RequestError:
        raise HTTPException(503, 'Бэкенд недоступен.') from None


@app.api_route('/api/v1/{path:path}', methods=['GET', 'POST'])
async def proxy_api(request: Request, path: str):
    target = '/api/v1/' + path
    if (request.method, target) not in PROXY_ROUTES:
        raise HTTPException(404)
    headers = {key: request.headers[key] for key in ('authorization', 'content-type') if key in request.headers}
    try:
        content = b''.join([chunk async for chunk in limited_stream(request, 64 * 1024)]) if request.method == 'POST' else b''
    except MultiPartException:
        raise HTTPException(413) from None
    upstream = await backend_request(request, request.method, target,
                                     params=request.query_params.multi_items(), headers=headers, content=content)
    headers = {'Content-Type': upstream.headers['content-type']} if 'content-type' in upstream.headers else {}
    return Response(upstream.content, status_code=upstream.status_code, headers=headers)


def run_inference(data):
    global PIPELINE, MODEL_FAILED
    try:
        try:
            with Image.open(io.BytesIO(data), formats=['JPEG', 'PNG']) as image:
                if image.width * image.height > MAX_PIXELS:
                    raise HTTPException(413, 'Слишком большое разрешение изображения.')
                if getattr(image, 'n_frames', 1) != 1:
                    raise HTTPException(415, 'Нужен JPEG или PNG с одним кадром.')
                pixels = np.asarray(ImageOps.exif_transpose(image).convert('RGB'))[:, :, ::-1].copy()
        except Image.DecompressionBombError:
            raise HTTPException(413, 'Слишком большое разрешение изображения.') from None
        except (OSError, ValueError, SyntaxError):
            raise HTTPException(415, 'Нужен читаемый JPEG или PNG.') from None

        if PIPELINE is None and not MODEL_FAILED:
            try:
                PIPELINE = FormOCRPipeline()
            except Exception:
                MODEL_FAILED = True
        if PIPELINE is None:
            raise HTTPException(503, 'OCR не запущен. Проверьте веса PP-OCRv6 Medium, словарь и зависимости.')
        try:
            return PIPELINE.process_image(pixels)
        except RejectedForm as error:
            raise HTTPException(422, str(error)) from None
        except Exception:
            raise HTTPException(503, 'Ошибка модели OCR. Доступен ручной ввод.') from None
    finally:
        INFERENCE.release()


@app.post('/ocr/recognize')
async def recognize(request: Request):
    auth = request.headers.get('authorization', '')
    if not re.fullmatch(r'Bearer [A-Za-z0-9_.-]+', auth, re.IGNORECASE):
        raise HTTPException(401, 'Войдите как наборщик или администратор.')
    me = await backend_request(request, 'GET', '/api/v1/auth/me', headers={'Authorization': auth})
    if me.status_code in (401, 403):
        raise HTTPException(me.status_code, 'Доступ к распознаванию отклонён.')
    try:
        user = me.json() if me.status_code == 200 else None
    except ValueError:
        user = None
    if not isinstance(user, dict):
        raise HTTPException(503, 'Не удалось проверить доступ через бэкенд.')
    if user.get('is_active') is not True or user.get('role') not in ('typist', 'admin'):
        raise HTTPException(403, 'Распознавание доступно активному наборщику или администратору.')
    if not request.headers.get('content-type', '').lower().startswith('multipart/form-data;'):
        raise HTTPException(415, 'Загрузите JPEG или PNG.')
    parser = MemoryMultipart(request.headers, limited_stream(request, MAX_UPLOAD), max_files=1, max_fields=0)
    try:
        form = await parser.parse()
    except MultiPartException as error:
        if error.message == 'request too large':
            raise HTTPException(413, 'Файл превышает 10 МБ.') from None
        raise HTTPException(400, 'Ожидается один файл JPEG или PNG.') from None
    try:
        file = form.get('file')
        if not isinstance(file, UploadFile) or file.content_type not in {'image/jpeg', 'image/png'}:
            raise HTTPException(415, 'Загрузите JPEG или PNG.')
        if file.size is None or file.size > MAX_FILE:
            raise HTTPException(413, 'Файл превышает 10 МБ.')
        if not INFERENCE.acquire(blocking=False):
            raise HTTPException(429, 'Сервис уже распознаёт другое фото. Попробуйте позже.')
        try:
            data = await file.read()
            task = asyncio.get_running_loop().run_in_executor(None, run_inference, data)
        except BaseException:
            INFERENCE.release()
            raise
        return await asyncio.shield(task)
    finally:
        await form.close()


@app.get('/{path:path}')
async def static(path: str):
    path = path or 'login.html'
    if path not in STATIC:
        raise HTTPException(404)
    asset = ROOT / path
    if path == 'api_config.js':
        js = 'window.MP_LOOPBACK_GATEWAY = true;\n' + asset.read_text(encoding='utf-8')
        return Response(js, media_type='text/javascript')
    if path.endswith('.html'):
        html = asset.read_text(encoding='utf-8')
        html = html.replace('<script src="https://cdn.tailwindcss.com"></script>',
                            '<link rel="stylesheet" href="/ocr_system/typist-gateway.css">')
        html = re.sub(r'<script>\s*tailwind\.config = \{.*?</script>', '', html, count=1, flags=re.S)
        return Response(html, media_type='text/html')
    return FileResponse(asset)


if __name__ == '__main__':
    uvicorn.run(app, host=HOST, port=PORT, access_log=False, proxy_headers=False)

