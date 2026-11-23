import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import os
import json

DEFAULT_CONFIG = {
    "event_name": "МАЙСКАЯ ПРОГУЛКА",
    "year": 2026,
    "event_date": "2026-05-17",
    "event_date_display": "17 мая 2026 г.",
    "distances": [
        {"id": "d1", "label": "50 км (Классика)"},
        {"id": "d2", "label": "33 км (Лесной)"},
        {"id": "d3", "label": "18 км (Шарташ)"},
        {"id": "d4", "label": "15 км (Городской)"}
    ]
}

class FormGenerator:
    """
    Генератор профессионального машиночитаемого бланка:
    1. По 4 углам размещаются стандартные ArUco-маркеры (DICT_4X4_50, IDs 0, 1, 2, 3),
       что гарантирует 100% стабильную детекцию и выравнивание перспективы с любого смартфона.
    2. Разметка оптимизирована под печатные буквы в ячейках.
    3. Поддерживается динамический год и список дистанций.
    """
    WIDTH = 1200
    HEIGHT = 1600

    def __init__(self, config=None, config_path="ocr_system/event_config.json"):
        if config is not None:
            self.config = config
        elif os.path.exists(config_path):
            with open(config_path, "r", encoding="utf-8") as f:
                self.config = json.load(f)
        else:
            self.config = DEFAULT_CONFIG

        self.aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
        self.marker_size = 70  # размер ArUco маркера в пикселях
        
        # Центры 4 маркеров: TL (id 0), TR (id 1), BR (id 2), BL (id 3)
        self.marker_centers = {
            0: (55, 55),
            1: (self.WIDTH - 55, 55),
            2: (self.WIDTH - 55, self.HEIGHT - 55),
            3: (55, self.HEIGHT - 55)
        }

    def _draw_aruco_markers(self, img_pil):
        # Рисуем 4 ArUco маркера
        for marker_id, (cx, cy) in self.marker_centers.items():
            marker_np = cv2.aruco.generateImageMarker(self.aruco_dict, marker_id, self.marker_size)
            # Добавляем белую рамку вокруг маркера для надежной детекции
            pad = 8
            bordered = cv2.copyMakeBorder(marker_np, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=255)
            marker_pil = Image.fromarray(bordered).convert("RGB")
            
            w, h = marker_pil.size
            img_pil.paste(marker_pil, (cx - w // 2, cy - h // 2))

    def create_blank(self):
        img = Image.new("RGB", (self.WIDTH, self.HEIGHT), color="white")
        draw = ImageDraw.Draw(img)

        # 1. Наносим ArUco маркеры по углам
        self._draw_aruco_markers(img)

        # Внешняя тонкая рамка документа
        draw.rectangle([10, 10, self.WIDTH - 10, self.HEIGHT - 10], outline="#cccccc", width=1)

        # Шрифты
        try:
            font_title = ImageFont.truetype("arialbd.ttf", 26)
            font_subtitle = ImageFont.truetype("arial.ttf", 16)
            font_label = ImageFont.truetype("arialbd.ttf", 14)
            font_small = ImageFont.truetype("arial.ttf", 12)
            font_mono = ImageFont.truetype("cour.ttf", 13)
        except:
            font_title = font_subtitle = font_label = font_small = font_mono = ImageFont.load_default()

        year = self.config.get("year", 2026)
        date_str = self.config.get("event_date_display", f"Май {year} г.")

        # Шапка
        draw.text((self.WIDTH // 2, 60), f"КАРТОЧКА УЧАСТНИКА «МАЙСКОЙ ПРОГУЛКИ {year}»", fill="black", font=font_title, anchor="mm")
        draw.text((self.WIDTH // 2, 95), f"{date_str} • Заполняйте строго ПЕЧАТНЫМИ буквами в коробочках (синей или черной ручкой)", fill="#333333", font=font_subtitle, anchor="mm")
        draw.line([(95, 115), (self.WIDTH - 95, 115)], fill="#000000", width=2)

        # Блок 1: Дистанция (OMR)
        draw.text((95, 132), "ДИСТАНЦИЯ:", fill="black", font=font_label)
        distances = self.config.get("distances", DEFAULT_CONFIG["distances"])
        
        base_x = 210
        x_step = 230
        for idx, dist in enumerate(distances[:4]):
            x = base_x + idx * x_step
            y = 128
            draw.rectangle([x, y, x + 24, y + 24], outline="black", width=2)
            draw.text((x + 32, y + 4), dist["label"], fill="black", font=font_small)

        # Функция отрисовки коробочек для букв
        def draw_grid_boxes(label, y_pos, count=24, box_w=28, box_h=34, start_x=220):
            if label:
                draw.text((95, y_pos + 8), label, fill="black", font=font_label)
            for i in range(count):
                bx = start_x + i * (box_w + 4)
                # Рамка ячейки светло-серая (чтобы не путать OCR)
                draw.rectangle([bx, y_pos, bx + box_w, y_pos + box_h], outline="#777777", width=1)
                # Риска
                draw.line([bx + 4, y_pos + box_h - 4, bx + box_w - 4, y_pos + box_h - 4], fill="#cccccc", width=1)

        # ФИО
        draw_grid_boxes("ФАМИЛИЯ:", 175, count=24)
        draw_grid_boxes("ИМЯ:", 230, count=24)
        draw_grid_boxes("ОТЧЕСТВО:", 285, count=24)

        # Дата рождения и пол
        draw.text((95, 348), "ДАТА РОЖД.:", fill="black", font=font_label)
        draw_grid_boxes("", 340, count=2, box_w=28, box_h=34, start_x=220)
        draw.text((288, 350), ".", fill="black", font=font_title)
        draw_grid_boxes("", 340, count=2, box_w=28, box_h=34, start_x=302)
        draw.text((370, 350), ".", fill="black", font=font_title)
        draw_grid_boxes("", 340, count=4, box_w=28, box_h=34, start_x=384)

        # Пол
        draw.text((540, 348), "ПОЛ:", fill="black", font=font_label)
        draw.rectangle([590, 345, 614, 369], outline="black", width=2)
        draw.text((624, 348), "М", fill="black", font=font_label)
        draw.rectangle([664, 345, 688, 369], outline="black", width=2)
        draw.text((698, 348), "Ж", fill="black", font=font_label)

        # Телефон
        draw.text((95, 403), "ТЕЛЕФОН:  +7", fill="black", font=font_label)
        draw_grid_boxes("", 395, count=10, box_w=28, box_h=34, start_x=220)

        # Email
        draw.text((95, 458), "E-MAIL:", fill="black", font=font_label)
        draw_grid_boxes("", 450, count=24, box_w=28, box_h=34, start_x=220)

        # Город
        draw.text((95, 513), "ГОРОД:", fill="black", font=font_label)
        draw_grid_boxes("", 505, count=20, box_w=28, box_h=34, start_x=220)

        # Ранее участвовал
        draw.text((95, 568), "РАНЕЕ УЧАСТИЙ:", fill="black", font=font_label)
        draw_grid_boxes("", 560, count=2, box_w=28, box_h=34, start_x=240)
        draw.text((320, 568), "раз", fill="black", font=font_small)

        # Согласие
        draw.line([(95, 615), (self.WIDTH - 95, 615)], fill="#aaaaaa", width=1)
        consent_text = (
            "Подтверждаю отсутствие противопоказаний, принимаю ответственность за жизнь и здоровье.\n"
            "Даю согласие на обработку персональных данных в соответствии с ФЗ-152."
        )
        draw.text((95, 630), consent_text, fill="#555555", font=font_small)

        draw.text((95, 685), "ПОДПИСЬ УЧАСТНИКА: _____________________", fill="black", font=font_label)
        draw.text((650, 685), f"ДАТА:  {date_str}", fill="black", font=font_label)

        # Служебный блок для волонтера / Номер карты
        draw.rectangle([95, 725, self.WIDTH - 95, 805], outline="#000000", width=2)
        draw.text((115, 735), f"СЛУЖЕБНАЯ ОТМЕТКА ВОЛОНТЕРА (КАРТА УЧАСТНИКА {year}):", fill="black", font=font_small)
        draw_grid_boxes("№ КАРТЫ:", 750, count=6, box_w=32, box_h=40, start_x=220)

        # Идентификатор бланка
        form_id_str = f"FORM-MP-{year}-AI-OCR-v3"
        draw.text((self.WIDTH - 270, self.HEIGHT - 45), form_id_str, fill="#666666", font=font_mono)

        return img

    def save_template(self, path="ocr_system/sample_form_template.png"):
        img = self.create_blank()
        img.save(path)
        print(f"Machine-readable template with ArUco saved to {path}")
        return path

if __name__ == "__main__":
    gen = FormGenerator()
    gen.save_template()
