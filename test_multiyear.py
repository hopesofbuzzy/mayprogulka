import sys
sys.stdout.reconfigure(encoding='utf-8')
from ocr_system.mock_filler import create_filled_sample
from ocr_system.pipeline import FormOCRPipeline
from ocr_system.form_generator import FormGenerator

print("=== ТЕСТ МУЛЬТИ-СЕЗОННОСТИ (ДИНАМИЧЕСКИЙ ГОД ПРОВЕДЕНИЯ) ===")

test_years = [2026, 2027, 2028, 2030]

for yr in test_years:
    config = {
        "event_name": "МАЙСКАЯ ПРОГУЛКА",
        "year": yr,
        "event_date": f"{yr}-05-16",
        "event_date_display": f"16 мая {yr} г.",
        "distances": [
            {"label": "50 км (Классика)"},
            {"label": "35 км (Юбилейный)"},
            {"label": "20 км (Озерный)"},
            {"label": "10 км (Семейный)"}
        ]
    }
    pipeline = FormOCRPipeline()
    pipeline.config = config
    pipeline.current_year = yr
    pipeline.validator.event_year = yr

    # Участник 1990 года рождения
    img = create_filled_sample("ВОЛКОВ", "ИГОРЬ", "АНАТОЛЬЕВИЧ", "10", "08", "1990", "M", "9123456789", "ЕКАТЕРИНБУРГ", "05", 1, "001122", add_noise=True)
    res = pipeline.process_image(img, override_year=yr)
    data = res["data"]

    print(f"Год прогулки: {yr} | Возраст участника: {data['calculated_age']} лет (рожд. {data['birth_date']}) | Дистанция: {data['distance']} | Статус: {res['status']}")

print("===========================================================")
