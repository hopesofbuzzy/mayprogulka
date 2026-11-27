# -*- coding: utf-8 -*-
"""Эталонные данные для бенчмарка OCR-пайплайна «Майской прогулки».

Два реальных фото:
1) test_data/20261127_212948.jpg — шаблон с чёрными угловыми квадратами (№ карты 009813)
2) test_data/20261127_191952.jpg — шаблон v2 с ArUco-маркерами (№ карты 014073)
Оба сняты с поворотом на ~90°, лист изогнут, освещение тусклое.
"""

REAL_PHOTOS = [
    {
        "path": "test_data/20261127_212948.jpg",
        "template": "black_squares",
        "form": {
            "distance": "33 км (Лесной)",
            "gender": "Мужской",
            "surname": "БАГРИНОВСКИЙ",
            "name": "ГЕОРГИЙ",
            "patronymic": "ОЛЕГОВИЧ",
            "birth_date": "14.06.2007",
            "phone": "+7 (912) 345-67-89",
            "email": "testabc@mail.ru",
            "city": "ЕКАТЕРИНБУРГ",
            "prev_participations": "3",
            "card_number": "009813",
        },
    },
    {
        "path": "test_data/20261127_191952.jpg",
        "template": "aruco",
        "form": {
            "distance": "33 км (Лесной)",
            "gender": "Мужской",
            "surname": "БАГРИНОВСКИЙ",
            "name": "ГЕОРГИЙ",
            "patronymic": "ОЛЕГОВИЧ",
            "birth_date": "14.06.2007",
            "phone": "+7 (912) 345-67-89",
            "email": "testabc@mail.ru",
            "city": "ЕКАТЕРИНБУРГ",
            "prev_participations": "3",
            "card_number": "014073",
        },
    },
]

# Диапазоны X, которые pipeline.process_image использует для чтения полей
# (для диагностики сегментации; mirror значений из ocr_system/pipeline.py)
FIELD_STRIPS = {
    "surname": (195, 1030),
    "name": (195, 1030),
    "patronymic": (195, 1030),
    "date": (195, 535),
    "phone": (195, 630),
    "email": (195, 1060),
    "city": (195, 920),
    "prev": (215, 345),
    "card": (195, 460),
}

# Ожидаемое число символов в поле (для сравнения с числом найденных ячеек)
FIELD_EXPECTED_LEN = {
    "surname": len("БАГРИНОВСКИЙ"),
    "name": len("ГЕОРГИЙ"),
    "patronymic": len("ОЛЕГОВИЧ"),
    "date": len("14062007"),
    "phone": len("9123456789"),
    "email": len("TESTABC@MAIL.RU"),
    "city": len("ЕКАТЕРИНБУРГ"),
    "prev": len("03"),
    "card": len("009813"),
}


def normalize_field(field_key, value):
    """Нормализация значения поля для честного сравнения (без учета формата)."""
    if value is None:
        return ""
    v = str(value).strip()
    if field_key == "phone":
        digits = "".join(ch for ch in v if ch.isdigit())
        if len(digits) == 11 and digits[0] in ("7", "8"):
            digits = digits[1:]
        return digits
    if field_key == "birth_date":
        return "".join(ch for ch in v if ch.isdigit())
    if field_key == "prev_participations":
        return v.lstrip("0") or ("0" if v else "")
    if field_key == "email":
        return v.lower().replace(" ", "")
    if field_key in ("distance", "gender", "city", "surname", "name", "patronymic"):
        return v.upper().replace(" ", "")
    return v.upper()
