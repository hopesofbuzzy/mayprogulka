import cv2
import numpy as np

class BoxedCharClassifier:
    """
    Классификатор символов в коробочках:
    Поддерживает кириллицу, цифры, дефис и пробелы.
    """
    def __init__(self, target_size=(28, 28)):
        self.target_size = target_size
        self.templates = {}
        self._build_templates()

    def _preprocess_cell(self, cell_bgr):
        if cell_bgr is None or cell_bgr.size == 0:
            return np.zeros(self.target_size, dtype=np.uint8), False

        gray = cv2.cvtColor(cell_bgr, cv2.COLOR_BGR2GRAY)
        
        # Инвертированная бинаризация: чернила темные (< 160)
        _, binary = cv2.threshold(gray, 170, 255, cv2.THRESH_BINARY_INV)

        # Убираем рамки по краям ячейки (морфологическая очистка границ)
        border_mask = np.zeros_like(binary)
        border_mask[3:-3, 3:-3] = 255
        binary = cv2.bitwise_and(binary, border_mask)

        # Подсчет процента чернил
        ink_pixels = np.count_nonzero(binary)
        density = ink_pixels / float(binary.size)

        # Пустая клетка
        if density < 0.025:
            return np.zeros(self.target_size, dtype=np.uint8), False

        coords = cv2.findNonZero(binary)
        if coords is None:
            return np.zeros(self.target_size, dtype=np.uint8), False

        x, y, bw, bh = cv2.boundingRect(coords)
        if bw < 3 or bh < 6:
            return np.zeros(self.target_size, dtype=np.uint8), False

        char_crop = binary[y:y+bh, x:x+bw]

        # Вписываем в 20x20 и центрируем в 28x28
        scale = min(20.0 / bh, 20.0 / bw)
        new_w, new_h = max(1, int(bw * scale)), max(1, int(bh * scale))
        resized = cv2.resize(char_crop, (new_w, new_h), interpolation=cv2.INTER_AREA)

        padded = np.zeros(self.target_size, dtype=np.uint8)
        start_x = (28 - new_w) // 2
        start_y = (28 - new_h) // 2
        padded[start_y:start_y + new_h, start_x:start_x + new_w] = resized

        return padded, True

    def _build_templates(self):
        from PIL import Image, ImageDraw, ImageFont
        chars = list("0123456789") + list("АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ-")
        fonts = []
        for fn in ["arialbd.ttf", "arial.ttf", "calibrib.ttf", "tahomabd.ttf"]:
            try:
                fonts.append(ImageFont.truetype(fn, 20))
            except:
                pass
        if not fonts:
            fonts.append(ImageFont.load_default())

        for ch in chars:
            samples = []
            for font in fonts:
                img = Image.new("RGB", (34, 34), color="white")
                draw = ImageDraw.Draw(img)
                draw.text((17, 17), ch, fill="black", font=font, anchor="mm")
                arr = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
                norm, has_ink = self._preprocess_cell(arr)
                if has_ink:
                    samples.append(norm.astype(np.float32) / 255.0)

            if samples:
                self.templates[ch] = np.mean(samples, axis=0)

    def predict_cell(self, cell_bgr, allowed_charset=None):
        norm_img, has_ink = self._preprocess_cell(cell_bgr)
        if not has_ink:
            return (" ", 1.0)

        vec = norm_img.astype(np.float32) / 255.0
        best_char = "?"
        best_score = -1.0

        candidates = allowed_charset if allowed_charset else self.templates.keys()

        for ch in candidates:
            if ch not in self.templates:
                continue
            tmpl = self.templates[ch]

            # IoU / Similarity
            overlap = np.sum(np.minimum(vec, tmpl))
            union = np.sum(np.maximum(vec, tmpl))
            score = overlap / (union + 1e-6)

            if score > best_score:
                best_score = score
                best_char = ch

        conf = min(0.99, float(best_score * 1.6))
        return (best_char, conf)

CYRILLIC_CHARS = "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ"
DIGITS = "0123456789"
