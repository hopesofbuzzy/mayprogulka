import cv2
import numpy as np

# Спецификация расположения полей на выровненном бланке 1200x1600
FORM_SCHEMA = {
    "distance": {
        "type": "omr_choice",
        "options": [
            {"id": "50km", "label": "50 км (Классика)", "rect": (200, 137, 22, 22)},
            {"id": "33km", "label": "33 км (Лесной)", "rect": (420, 137, 22, 22)},
            {"id": "18km", "label": "18 км (Шарташ)", "rect": (630, 137, 22, 22)},
            {"id": "15km", "label": "15 км (Городской)", "rect": (840, 137, 22, 22)}
        ]
    },
    "gender": {
        "type": "omr_choice",
        "options": [
            {"id": "M", "label": "Мужской", "rect": (590, 360, 22, 22)},
            {"id": "F", "label": "Женский", "rect": (660, 360, 22, 22)}
        ]
    },
    "surname": {
        "type": "boxed_text",
        "y": 190,
        "box_count": 24,
        "box_w": 28,
        "box_h": 34,
        "start_x": 220,
        "gap": 5
    },
    "name": {
        "type": "boxed_text",
        "y": 245,
        "box_count": 24,
        "box_w": 28,
        "box_h": 34,
        "start_x": 220,
        "gap": 5
    },
    "patronymic": {
        "type": "boxed_text",
        "y": 300,
        "box_count": 24,
        "box_w": 28,
        "box_h": 34,
        "start_x": 220,
        "gap": 5
    },
    "birth_day": {
        "type": "boxed_text",
        "y": 355,
        "box_count": 2,
        "box_w": 28,
        "box_h": 34,
        "start_x": 220,
        "gap": 5
    },
    "birth_month": {
        "type": "boxed_text",
        "y": 355,
        "box_count": 2,
        "box_w": 28,
        "box_h": 34,
        "start_x": 305,
        "gap": 5
    },
    "birth_year": {
        "type": "boxed_text",
        "y": 355,
        "box_count": 4,
        "box_w": 28,
        "box_h": 34,
        "start_x": 390,
        "gap": 5
    },
    "phone": {
        "type": "boxed_text",
        "y": 410,
        "box_count": 10,
        "box_w": 28,
        "box_h": 34,
        "start_x": 220,
        "gap": 5
    },
    "city": {
        "type": "boxed_text",
        "y": 520,
        "box_count": 20,
        "box_w": 28,
        "box_h": 34,
        "start_x": 220,
        "gap": 5
    },
    "prev_walks": {
        "type": "boxed_text",
        "y": 575,
        "box_count": 2,
        "box_w": 28,
        "box_h": 34,
        "start_x": 240,
        "gap": 5
    },
    "card_number": {
        "type": "boxed_text",
        "y": 785,
        "box_count": 6,
        "box_w": 32,
        "box_h": 40,
        "start_x": 220,
        "gap": 5
    }
}

class FormExtractor:
    def __init__(self, schema=FORM_SCHEMA):
        self.schema = schema

    def extract_omr(self, aligned_image, field_key):
        cfg = self.schema[field_key]
        results = []
        gray = cv2.cvtColor(aligned_image, cv2.COLOR_BGR2GRAY)

        for opt in cfg["options"]:
            x, y, w, h = opt["rect"]
            pad = 3
            roi = gray[y + pad : y + h - pad, x + pad : x + w - pad]
            _, thresh = cv2.threshold(roi, 160, 255, cv2.THRESH_BINARY_INV)
            fill_ratio = float(np.sum(thresh > 0)) / (thresh.shape[0] * thresh.shape[1])
            is_checked = fill_ratio > 0.15
            results.append({
                "id": opt["id"],
                "label": opt["label"],
                "fill_ratio": fill_ratio,
                "checked": is_checked
            })
        return results

    def extract_cell_images(self, aligned_image, field_key):
        cfg = self.schema[field_key]
        cells = []
        y = cfg["y"]
        bw = cfg["box_w"]
        bh = cfg["box_h"]
        start_x = cfg["start_x"]
        gap = cfg["gap"]

        for i in range(cfg["box_count"]):
            bx = start_x + i * (bw + gap)
            # Берем строго внутреннюю часть ячейки (без внешних серых линий)
            cell_crop = aligned_image[y + 2 : y + bh - 2, bx + 2 : bx + bw - 2]
            cells.append({
                "index": i,
                "box": (bx, y, bw, bh),
                "image": cell_crop
            })
        return cells
