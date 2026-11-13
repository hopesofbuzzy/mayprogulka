from .form_generator import FormGenerator
from PIL import Image, ImageDraw, ImageFont
import cv2
import numpy as np
import random

def create_filled_sample(
    surname="СМИРНОВ",
    name="АЛЕКСАНДР",
    patronymic="СЕРГЕЕВИЧ",
    day="14",
    month="06",
    year="1992",
    gender="M",
    phone="9126482190",
    city="ЕКАТЕРИНБУРГ",
    prev="04",
    dist_index=1, # 33 км
    card="042189",
    add_noise=True
):
    gen = FormGenerator()
    img = gen.create_blank()
    draw = ImageDraw.Draw(img)

    try:
        font_hand = ImageFont.truetype("arialbd.ttf", 20)
    except:
        font_hand = ImageFont.load_default()

    # Заполнение OMR (галочка/крестик в чекбокс)
    distances_coords = [(200, 137), (420, 137), (630, 137), (840, 137)]
    dx, dy = distances_coords[dist_index]
    # Рисуем реалистичный крестик
    draw.line([dx + 4, dy + 4, dx + 18, dy + 18], fill="#111155", width=3)
    draw.line([dx + 18, dy + 4, dx + 4, dy + 18], fill="#111155", width=3)

    # Пол
    gx, gy = (590, 360) if gender == "M" else (660, 360)
    draw.line([gx + 4, gy + 4, gx + 18, gy + 18], fill="#111155", width=3)
    draw.line([gx + 18, gy + 4, gx + 4, gy + 18], fill="#111155", width=3)

    # Вспомогательная функция вписывания печатных букв
    def fill_boxes(text, y_pos, start_x=220, box_w=28, box_h=34, gap=5):
        for i, ch in enumerate(text):
            bx = start_x + i * (box_w + gap)
            # Небольшой реалистичный рукописный джиттер (смещение на 1-2 пикселя)
            jitter_x = random.randint(-1, 1) if add_noise else 0
            jitter_y = random.randint(-1, 1) if add_noise else 0
            draw.text((bx + box_w // 2 + jitter_x, y_pos + box_h // 2 + jitter_y), ch, fill="#1a1a66", font=font_hand, anchor="mm")

    fill_boxes(surname, 190)
    fill_boxes(name, 245)
    fill_boxes(patronymic, 300)

    # Дата
    fill_boxes(day, 355, start_x=220)
    fill_boxes(month, 355, start_x=305)
    fill_boxes(year, 355, start_x=390)

    # Телефон
    fill_boxes(phone, 410, start_x=220)

    # Email
    fill_boxes("SMIRNOV@MAIL.RU", 465, start_x=220)

    # Город
    fill_boxes(city, 520, start_x=220)

    # Предыдущие участия
    fill_boxes(prev, 575, start_x=240)

    # Карта волонтера
    fill_boxes(card, 785, start_x=220, box_w=32, box_h=40)

    # Подпись
    draw.line([150, 720, 260, 715], fill="#111155", width=2)
    draw.arc([180, 705, 230, 735], 0, 360, fill="#111155", width=2)

    img_np = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)

    if add_noise:
        # Имитируем съемку под легким углом на смартфон (перспективное искажение)
        h, w = img_np.shape[:2]
        pts1 = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
        pts2 = np.float32([[15, 25], [w - 20, 10], [w - 10, h - 15], [30, h - 20]])
        matrix = cv2.getPerspectiveTransform(pts1, pts2)
        distorted = cv2.warpPerspective(img_np, matrix, (w, h), borderValue=(240, 240, 240))
        return distorted

    return img_np

if __name__ == "__main__":
    sample = create_filled_sample()
    cv2.imwrite("ocr_system/sample_filled_test.png", sample)
    print("Sample filled test created at ocr_system/sample_filled_test.png")
