import sys
sys.stdout.reconfigure(encoding='utf-8')
import cv2
from ocr_system.pipeline import FormOCRPipeline

img_path = r"C:/Users/yulia/.gemini/antigravity/brain/716b16ca-a259-447f-848c-30e9c20c576a/.user_uploaded/media_1795443673179_eacf35dd.jpg"
img = cv2.imread(img_path)

if img is None:
    print(f"Error: could not load {img_path}")
    sys.exit(1)

pipeline = FormOCRPipeline()
result = pipeline.process_image(img)

print("\n" + "="*55)
print("   РЕЗУЛЬТАТ РАСПОЗНАВАНИЯ РЕАЛЬНОГО ФОТО АНКЕТЫ")
print("="*55)
print(f"Статус:              {result['status']}")
print(f"Точность (Conf):     {result['overall_confidence']}%")
print(f"Выравнивание:        {'УСПЕШНО (Homography 4-point)' if result['strictly_aligned'] else 'Базовое'}")
print("-" * 55)
d = result["data"]
print(f"Дистанция:           {d['distance']}")
print(f"Пол:                 {d['gender']}")
print(f"Фамилия:             {d['surname']}")
print(f"Имя:                 {d['name']}")
print(f"Отчество:            {d['patronymic'] if d['patronymic'] else '(не заполнено)'}")
print(f"Дата рождения:       {d['birth_date']} (Возраст: {d['calculated_age']} лет)")
print(f"Телефон:             {d['phone']}")
print(f"E-mail:              {d['email']}")
print(f"Город:               {d['city']}")
print(f"Прежде участвовал:   {d['prev_participations']} раз")
print("="*55)
