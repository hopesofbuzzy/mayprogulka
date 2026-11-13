import cv2
import json
from ocr_system.pipeline import FormOCRPipeline

def run_test():
    img_path = "ocr_system/sample_filled_test.png"
    img = cv2.imread(img_path)
    if img is None:
        print(f"Error: could not read {img_path}")
        return

    print(f"Processing image {img_path} ({img.shape[1]}x{img.shape[0]})...")
    pipeline = FormOCRPipeline()
    result = pipeline.process_image(img)

    print("\n" + "="*50)
    print("      РЕЗУЛЬТАТ РАСПОЗНАВАНИЯ АНКЕТЫ OCR")
    print("="*50)
    print(f"Статус:              {result['status']}")
    print(f"Точность (Conf):     {result['overall_confidence']}%")
    print(f"Выравнивание:        {'УСПЕШНО (Homography 4-point)' if result['strictly_aligned'] else 'Базовое'}")
    print("-" * 50)
    data = result["data"]
    print(f"Дистанция:           {data['distance']}")
    print(f"Пол:                 {data['gender']}")
    print(f"ФИО:                 {data['surname']} {data['name']} {data['patronymic']}")
    print(f"Дата рождения:       {data['birth_date']} (Возраст: {data['calculated_age']} лет)")
    print(f"Телефон:             {data['phone']}")
    print(f"Город:               {data['city']}")
    print(f"Прежде участвовал:   {data['prev_participations']} раз")
    print(f"Номер карты:         {data['card_number']}")
    print("="*50)

if __name__ == "__main__":
    run_test()
