import cv2
import numpy as np

FORM_SCHEMA = {
    "distance": {
        "type": "omr_choice",
        "options": [
            {"id": "50km", "label": "50 км (Классика)", "rect": (210, 128, 24, 24)},
            {"id": "33km", "label": "33 км (Лесной)", "rect": (440, 128, 24, 24)},
            {"id": "18km", "label": "18 км (Шарташ)", "rect": (670, 128, 24, 24)},
            {"id": "15km", "label": "15 км (Городской)", "rect": (900, 128, 24, 24)}
        ]
    },
    "gender": {
        "type": "omr_choice",
        "options": [
            {"id": "M", "label": "Мужской", "rect": (590, 345, 24, 24)},
            {"id": "F", "label": "Женский", "rect": (664, 345, 24, 24)}
        ]
    },
    # Полосовые регионы интереса (ROI) для глубокой OCR-нейросети: (x, y, w, h)
    "surname_strip": {"rect": (215, 170, 775, 44), "mode": "cyrillic"},
    "name_strip": {"rect": (215, 225, 775, 44), "mode": "cyrillic"},
    "patronymic_strip": {"rect": (215, 280, 775, 44), "mode": "cyrillic"},
    "birth_strip": {"rect": (215, 335, 310, 44), "mode": "digits"},
    "phone_strip": {"rect": (215, 390, 330, 44), "mode": "digits"},
    "email_strip": {"rect": (215, 445, 775, 44), "mode": "mixed"},
    "city_strip": {"rect": (215, 500, 650, 44), "mode": "cyrillic"},
    "prev_walks_strip": {"rect": (235, 555, 75, 44), "mode": "digits"},
    "card_strip": {"rect": (215, 745, 225, 50), "mode": "digits"}
}

class FormExtractor:
    """
    Извлекает регионы интереса (ROI) с выровненного листа 1200x1600:
    - OMR чекбоксы (дистанция, пол)
    - Текстовые полосы для подачи в нейросетевой OCR
    """
    def __init__(self, schema=FORM_SCHEMA):
        self.schema = schema

    def extract_omr(self, aligned_image, field_key):
        cfg = self.schema[field_key]
        results = []
        gray = cv2.cvtColor(aligned_image, cv2.COLOR_BGR2GRAY)

        for opt in cfg["options"]:
            x, y, w, h = opt["rect"]
            # Отрезаем внешнюю границу чекбокса (отступ 4px)
            pad = 4
            roi = gray[y + pad : y + h - pad, x + pad : x + w - pad]
            # Адаптивная бинаризация Otsu
            _, thresh = cv2.threshold(roi, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
            fill_ratio = float(np.count_nonzero(thresh)) / (thresh.shape[0] * thresh.shape[1])
            is_checked = fill_ratio > 0.16 # галочка или крестик занимают >16% площади внутри чекбокса
            results.append({
                "id": opt["id"],
                "label": opt["label"],
                "fill_ratio": fill_ratio,
                "checked": is_checked
            })
        return results

    def extract_field_strip(self, aligned_image, field_key):
        """
        Извлекает цельный фрагмент изображения полосы полей (ROI).
        """
        cfg = self.schema[field_key]
        x, y, w, h = cfg["rect"]
        # Безопасное кадрирование в пределах изображения
        img_h, img_w = aligned_image.shape[:2]
        x1 = max(0, x)
        y1 = max(0, y)
        x2 = min(img_w, x + w)
        y2 = min(img_h, y + h)

        strip_crop = aligned_image[y1:y2, x1:x2].copy()
        return strip_crop, cfg.get("mode", "cyrillic")
