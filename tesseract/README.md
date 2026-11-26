# Локальный OCR-движок (tesseract.js)

Папка нужна для офлайн-распознавания бумажных анкет на `typist_station.html`.
Фото обрабатывается в браузере и никуда не отправляется.

## Состав

- `tesseract.min.js` — tesseract.js 5.1.1 (браузерный бандл)
- `worker.min.js` — воркер tesseract.js 5.1.1
- `tesseract-core-simd-lstm.wasm.js` + `.wasm` — SIMD+LSTM ядро (основное)
- `tesseract-core-lstm.wasm.js` + `.wasm` — LSTM ядро без SIMD (fallback)
- `rus.traineddata.gz`, `eng.traineddata.gz` — языковые модели tessdata 4.0.0

В `typist_station.html` используется OEM = 1 (только LSTM), поэтому legacy-ядра
`tesseract-core*.wasm` (без `-lstm`) удалены — они не загружаются.

## Источники

- https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/
- https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/
- https://tessdata.projectnaptha.com/4.0.0/

Лицензия: Apache-2.0 (tesseract.js, tesseract.js-core, tessdata).

## Обновление

Скачать файлы той же версии в эту папку. Пути задаются в `typist_station.html`
в вызове `Tesseract.createWorker(...)`: `workerPath`, `corePath`, `langPath`.
