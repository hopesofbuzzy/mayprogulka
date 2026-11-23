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

    # Используем шрифт с имитацией живого почерка / ручки
    try:
        font_hand = ImageFont.truetype("arialbd.ttf", 22)
    except:
        font_hand = ImageFont.load_default()

    # OMR Дистанция (крестик ручкой)
    dist_coords = [(210, 128), (440, 128), (670, 128), (900, 128)]
    dx, dy = dist_coords[dist_index % len(dist_coords)]
    draw.line([dx + 4, dy + 4, dx + 20, dy + 20], fill="#111166", width=3)
    draw.line([dx + 20, dy + 4, dx + 4, dy + 20], fill="#111166", width=3)

    # OMR Пол
    gx, gy = (590, 345) if gender == "M" else (664, 345)
    draw.line([gx + 4, gy + 4, gx + 20, gy + 20], fill="#111166", width=3)
    draw.line([gx + 20, gy + 4, gx + 4, gy + 20], fill="#111166", width=3)

    # Заполнение коробочек
    def fill_boxes(text, y_pos, start_x=220, box_w=28, box_h=34, gap=4):
        for i, ch in enumerate(text):
            bx = start_x + i * (box_w + gap)
            jx = random.randint(-1, 1) if add_noise else 0
            jy = random.randint(-1, 1) if add_noise else 0
            draw.text((bx + box_w // 2 + jx, y_pos + box_h // 2 + jy), ch, fill="#15206b", font=font_hand, anchor="mm")

    fill_boxes(surname, 175)
    fill_boxes(name, 230)
    fill_boxes(patronymic, 285)

    # Дата
    fill_boxes(day, 340, start_x=220)
    fill_boxes(month, 340, start_x=302)
    fill_boxes(year, 340, start_x=384)

    # Телефон
    fill_boxes(phone, 395, start_x=220)

    # Email
    fill_boxes("SMIRNOV@MAIL.RU", 450, start_x=220)

    # Город
    fill_boxes(city, 505, start_x=220)

    # Предыдущие участия
    fill_boxes(prev, 560, start_x=240)

    # Номер карты
    fill_boxes(card, 750, start_x=220, box_w=32, box_h=40)

    # Подпись
    draw.line([160, 685, 270, 680], fill="#111166", width=2)
    draw.arc([190, 670, 240, 700], 0, 360, fill="#111166", width=2)

    img_np = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)

    if add_noise:
        # Имитация реального фото со смартфона:
        # 1. Лист лежит на столе с фоном вокруг него
        table_h, table_w = 1900, 1500
        table_bg = np.full((table_h, table_w, 3), (180, 190, 195), dtype=np.uint8) # Серый стол
        # Добавляем градиент освещения (тень от смартфона)
        for y in range(table_h):
            table_bg[y, :] = np.clip(table_bg[y, :].astype(int) - int(30 * (y / table_h)), 0, 255).astype(np.uint8)

        # 2. Перспективный наклон (телефон держат под углом 15-20 градусов)
        src_pts = np.float32([[0, 0], [gen.WIDTH, 0], [gen.WIDTH, gen.HEIGHT], [0, gen.HEIGHT]])
        dst_pts = np.float32([
            [120, 140],             # TL
            [table_w - 140, 100],   # TR
            [table_w - 90, table_h - 130], # BR
            [160, table_h - 110]    # BL
        ])
        matrix = cv2.getPerspectiveTransform(src_pts, dst_pts)
        warped_sheet = cv2.warpPerspective(img_np, matrix, (table_w, table_h))

        # Создаем маску листа
        mask = np.zeros((gen.HEIGHT, gen.WIDTH), dtype=np.uint8)
        mask[:] = 255
        warped_mask = cv2.warpPerspective(mask, matrix, (table_w, table_h))

        # Накладываем лист на стол
        table_bg[warped_mask > 0] = warped_sheet[warped_mask > 0]
        return table_bg

    return img_np

if __name__ == "__main__":
    sample = create_filled_sample(add_noise=True)
    cv2.imwrite("ocr_system/sample_filled_test.png", sample)
    print("Realistic phone photo sample created at ocr_system/sample_filled_test.png")
