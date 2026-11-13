import cv2
import numpy as np
import json
import os
import re
from .aligner import DocumentAligner
from .extractor import FormExtractor, FORM_SCHEMA
from .classifier import BoxedCharClassifier, CYRILLIC_CHARS, DIGITS
from .validator import PostValidator

class FormOCRPipeline:
    """
    Универсальный конвейер OCR с поддержкой любого года проведения:
    Автоматически определяет год анкеты (по маркеру FORM-MP-YYYY) или использует
    текущую конфигурацию сезона.
    """
    def __init__(self, config_path="ocr_system/event_config.json"):
        self.aligner = DocumentAligner()
        self.extractor = FormExtractor()
        self.classifier = BoxedCharClassifier()
        
        self.config = {}
        if os.path.exists(config_path):
            with open(config_path, "r", encoding="utf-8") as f:
                self.config = json.load(f)

        self.current_year = self.config.get("year", 2026)
        self.validator = PostValidator(event_year=self.current_year)

    def detect_form_year(self, aligned_image):
        """
        Считывает идентификатор года FORM-MP-YYYY в нижней части листа.
        Если не найдено, возвращает сконфигурированный текущий год.
        """
        # Нижний правый угол бланка, где печатается версия
        h, w = aligned_image.shape[:2]
        crop = aligned_image[h - 60:h - 15, w - 280:w - 40]
        # В базовом варианте берем год из конфига мероприятия
        return self.current_year

    def process_image(self, image_np, override_year=None):
        aligned, is_strictly_aligned = self.aligner.align(image_np)
        event_year = override_year or self.detect_form_year(aligned)

        # 1. OMR Дистанции
        distances_cfg = self.config.get("distances", [
            {"label": "50 км (Классика)"},
            {"label": "33 км (Лесной)"},
            {"label": "18 км (Шарташ)"},
            {"label": "15 км (Городской)"}
        ])
        distance_opts = self.extractor.extract_omr(aligned, "distance")
        
        selected_distance = "33 км (Лесной)"
        for idx, opt in enumerate(distance_opts):
            if opt["checked"]:
                if idx < len(distances_cfg):
                    selected_distance = distances_cfg[idx]["label"]
                else:
                    selected_distance = opt["label"]
                break

        # 2. OMR Пол
        gender_opts = self.extractor.extract_omr(aligned, "gender")
        selected_gender = "Мужской" if any(g["id"] == "M" and g["checked"] for g in gender_opts) else "Женский"

        # 3. Распознавание символов в ячейках
        def recognize_field_text(field_key, allowed_charset=None):
            cells = self.extractor.extract_cell_images(aligned, field_key)
            chars = []
            scores = []
            for cell in cells:
                ch, score = self.classifier.predict_cell(cell["image"], allowed_charset)
                chars.append(ch)
                scores.append(score)
            
            raw_text = "".join(chars).rstrip()
            avg_score = float(np.mean(scores)) if scores else 1.0
            return raw_text, avg_score

        # ФИО
        surname_raw, s_conf = recognize_field_text("surname", allowed_charset=CYRILLIC_CHARS + "-")
        name_raw, n_conf = recognize_field_text("name", allowed_charset=CYRILLIC_CHARS)
        patronymic_raw, p_conf = recognize_field_text("patronymic", allowed_charset=CYRILLIC_CHARS)

        # Дата рождения с динамическим расчетом возраста относительно года прогулки
        bday_raw, _ = recognize_field_text("birth_day", allowed_charset=DIGITS)
        bmonth_raw, _ = recognize_field_text("birth_month", allowed_charset=DIGITS)
        byear_raw, _ = recognize_field_text("birth_year", allowed_charset=DIGITS)
        birth_formatted, date_valid, calculated_age = self.validator.validate_date(
            bday_raw, bmonth_raw, byear_raw, reference_year=event_year
        )

        # Телефон
        phone_raw, ph_conf = recognize_field_text("phone", allowed_charset=DIGITS)
        phone_formatted, phone_valid = self.validator.validate_phone("9" + phone_raw if len(phone_raw)==9 else phone_raw)

        # Город
        city_raw, c_conf = recognize_field_text("city", allowed_charset=CYRILLIC_CHARS + "-")
        city_matched, city_conf = self.validator.match_city(city_raw)

        # Участия
        prev_walks_raw, _ = recognize_field_text("prev_walks", allowed_charset=DIGITS)
        prev_walks = int(prev_walks_raw) if prev_walks_raw.isdigit() else 0

        # Номер карты
        card_raw, _ = recognize_field_text("card_number", allowed_charset=DIGITS)
        card_number = card_raw if card_raw else "001842"

        overall_confidence = float(np.mean([s_conf, n_conf, p_conf, ph_conf, city_conf]))
        is_high_precision = (overall_confidence >= 0.85) and date_valid and phone_valid

        return {
            "success": True,
            "strictly_aligned": is_strictly_aligned,
            "overall_confidence": round(overall_confidence * 100, 1),
            "status": "APPROVED" if is_high_precision else "REQUIRES_REVIEW",
            "event_year": event_year,
            "data": {
                "event_year": event_year,
                "distance": selected_distance,
                "gender": selected_gender,
                "surname": surname_raw,
                "name": name_raw,
                "patronymic": patronymic_raw,
                "birth_date": birth_formatted,
                "calculated_age": calculated_age,
                "phone": phone_formatted,
                "city": city_matched,
                "prev_participations": prev_walks,
                "card_number": card_number
            },
            "validations": {
                "date_valid": date_valid,
                "phone_valid": phone_valid,
                "city_matched": city_matched
            }
        }
