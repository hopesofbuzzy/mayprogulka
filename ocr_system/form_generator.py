import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import os
import json
import datetime

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
    Параметризованный генератор бланка анкеты:
    Год, точная дата проведения и список дистанций передаются динамически.
    В правый верхний угол впечатывается служебный код конфигурации (form-id/QR).
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

        # Реперные маркеры по углам
        self.markers = [
            (50, 50),
            (self.WIDTH - 50, 50),
            (self.WIDTH - 50, self.HEIGHT - 50),
            (50, self.HEIGHT - 50)
        ]

    def create_blank(self):
        img = Image.new("RGB", (self.WIDTH, self.HEIGHT), color="white")
        draw = ImageDraw.Draw(img)

        # 4 угловых маркера
        marker_size = 40
        for x, y in self.markers:
            draw.rectangle(
                [x - marker_size // 2, y - marker_size // 2, x + marker_size // 2, y + marker_size // 2],
                fill="black"
            )

        # Шрифты
        try:
            font_title = ImageFont.truetype("arialbd.ttf", 26)
            font_subtitle = ImageFont.truetype("arial.ttf", 16)
            font_label = ImageFont.truetype("arial.ttf", 15)
            font_small = ImageFont.truetype("arial.ttf", 12)
            font_mono = ImageFont.truetype("cour.ttf", 14)
        except:
            font_title = font_subtitle = font_label = font_small = font_mono = ImageFont.load_default()

        year = self.config.get("year", 2026)
        date_str = self.config.get("event_date_display", f"Май {year} г.")

        # Шапка с динамическим годом и датой
        draw.text((self.WIDTH // 2, 70), f"КАРТОЧКА УЧАСТНИКА «МАЙСКОЙ ПРОГУЛКИ {year}»", fill="black", font=font_title, anchor="mm")
        draw.text((self.WIDTH // 2, 105), f"{date_str} • Заполняйте строго ПЕЧАТНЫМИ буквами в коробочках", fill="#333333", font=font_subtitle, anchor="mm")
        draw.line([(80, 125), (self.WIDTH - 80, 125)], fill="#000000", width=2)

        # Блок 1: Динамические дистанции (до 4 вариантов)
        draw.text((80, 140), "ДИСТАНЦИЯ:", fill="black", font=font_label)
        distances = self.config.get("distances", DEFAULT_CONFIG["distances"])
        
        base_x = 200
        x_step = 230
        for idx, dist in enumerate(distances[:4]):
            x = base_x + idx * x_step
            y = 137
            draw.rectangle([x, y, x + 22, y + 22], outline="black", width=2)
            draw.text((x + 28, y + 3), dist["label"], fill="black", font=font_small)

        # Функция отрисовки коробочек
        def draw_grid_boxes(label, y_pos, count=24, box_w=28, box_h=34, start_x=220):
            if label:
                draw.text((80, y_pos + 8), label, fill="black", font=font_label)
            for i in range(count):
                bx = start_x + i * (box_w + 5)
                draw.rectangle([bx, y_pos, bx + box_w, y_pos + box_h], outline="#888888", width=1)
                draw.line([bx + 4, y_pos + box_h - 4, bx + box_w - 4, y_pos + box_h - 4], fill="#cccccc", width=1)

        # Поля ФИО
        draw_grid_boxes("ФАМИЛИЯ:", 190, count=24)
        draw_grid_boxes("ИМЯ:", 245, count=24)
        draw_grid_boxes("ОТЧЕСТВО:", 300, count=24)

        # Дата рождения и пол
        draw.text((80, 363), "ДАТА РОЖД.:", fill="black", font=font_label)
        draw_grid_boxes("", 355, count=2, box_w=28, box_h=34, start_x=220)
        draw.text((290, 365), ".", fill="black", font=font_title)
        draw_grid_boxes("", 355, count=2, box_w=28, box_h=34, start_x=305)
        draw.text((375, 365), ".", fill="black", font=font_title)
        draw_grid_boxes("", 355, count=4, box_w=28, box_h=34, start_x=390)

        # Пол
        draw.text((540, 363), "ПОЛ:", fill="black", font=font_label)
        draw.rectangle([590, 360, 612, 382], outline="black", width=2)
        draw.text((620, 365), "М", fill="black", font=font_label)
        draw.rectangle([660, 360, 682, 382], outline="black", width=2)
        draw.text((690, 365), "Ж", fill="black", font=font_label)

        # Телефон
        draw.text((80, 420), "ТЕЛЕФОН:  +7", fill="black", font=font_label)
        draw_grid_boxes("", 410, count=10, box_w=28, box_h=34, start_x=220)

        # Email
        draw.text((80, 475), "E-MAIL:", fill="black", font=font_label)
        draw_grid_boxes("", 465, count=24, box_w=28, box_h=34, start_x=220)

        # Город
        draw.text((80, 530), "ГОРОД:", fill="black", font=font_label)
        draw_grid_boxes("", 520, count=20, box_w=28, box_h=34, start_x=220)

        # Ранее участвовал
        draw.text((80, 585), "РАНЕЕ УЧАСТИЙ:", fill="black", font=font_label)
        draw_grid_boxes("", 575, count=2, box_w=28, box_h=34, start_x=240)
        draw.text((320, 585), "раз", fill="black", font=font_label)

        # Согласие
        draw.line([(80, 640), (self.WIDTH - 80, 640)], fill="#aaaaaa", width=1)
        consent_text = (
            "Подтверждаю отсутствие противопоказаний, принимаю ответственность за жизнь и здоровье.\n"
            "Даю согласие на обработку персональных данных в соответствии с ФЗ-152."
        )
        draw.text((80, 655), consent_text, fill="#555555", font=font_small)

        draw.text((80, 720), "ПОДПИСЬ УЧАСТНИКА: _____________________", fill="black", font=font_label)
        draw.text((650, 720), f"ДАТА:  {date_str}", fill="black", font=font_label)

        # Служебный блок для волонтера / Номер карты
        draw.rectangle([80, 760, self.WIDTH - 80, 840], outline="#000000", width=2)
        draw.text((100, 770), f"СЛУЖЕБНАЯ ОТМЕТКА ВОЛОНТЕРА (КАРТА УЧАСТНИКА {year}):", fill="black", font=font_small)
        draw_grid_boxes("№ КАРТЫ:", 785, count=6, box_w=32, box_h=40, start_x=220)

        # Машиночитаемый идентификатор версии бланка (штрихкод/метка года внизу)
        form_id_str = f"FORM-MP-{year}-v2.1"
        draw.text((self.WIDTH - 250, self.HEIGHT - 40), form_id_str, fill="#666666", font=font_mono)

        return img

    def save_template(self, path="ocr_system/sample_form_template.png"):
        img = self.create_blank()
        img.save(path)
        print(f"Template saved to {path} for year {self.config.get('year')}")
        return path

if __name__ == "__main__":
    gen = FormGenerator()
    gen.save_template()
