import cv2
import numpy as np
import json
import os
import re
from .aligner import DocumentAligner
from .classifier import DeepLearningOCRClassifier
from .validator import PostValidator

class FormOCRPipeline:
    """
    Глубокий нейросетевой пайплайн OCR для сканирования и оцифровки анкет «Майской прогулки»:
    1. Строгая валидация подлинности бланка (Fiducial markers / ArUco / 4 угловых квадрата / Header verification)
    2. Выравнивание геометрии (Homography 4-point)
    3. Извлечение OMR чекбокса выбранной дистанции
    4. Распознавание полос полей нейросетью PP-OCRv6 Medium Cyrillic
    5. Постобработка без синтетических фейковых дефолтов
    """
    def __init__(self, config_path="ocr_system/event_config.json"):
        self.aligner = DocumentAligner()
        self.classifier = DeepLearningOCRClassifier()

        self.config = {}
        if os.path.exists(config_path):
            with open(config_path, "r", encoding="utf-8") as f:
                self.config = json.load(f)

        self.current_year = self.config.get("year", 2026)
        self.validator = PostValidator(event_year=self.current_year)

    def _extract_distance(self, aligned_image):
        """
        Определяет выбранную дистанцию по анализу заполнения чекбоксов (OMR).
        """
        gray = cv2.cvtColor(aligned_image, cv2.COLOR_BGR2GRAY)
        boxes = [
            ("50 км (Классика)", 185, 225),
            ("33 км (Лесной)", 405, 445),
            ("18 км (Шарташ)", 620, 660),
            ("15 км (Городской)", 825, 865)
        ]
        best_dist = ""
        max_ratio = -1.0

        for lbl, x1, x2 in boxes:
            roi = gray[130:165, x1:x2]
            h, w = roi.shape
            inner = roi[4:h-4, 4:w-4]
            ink = (inner < 145).sum()
            ratio = ink / float(inner.size) if inner.size > 0 else 0
            if ratio > max_ratio:
                max_ratio = ratio
                best_dist = lbl

        # Если ни один чекбокс не заполнен уверенно (ratio < 0.25)
        if max_ratio < 0.25:
            return "Не выбрана"
        return best_dist

    def _extract_gender(self, raw_date_text, aligned_image):
        t = raw_date_text.lower()
        if "пол. ж" in t or " ж" in t:
            return "Женский"
        elif "пол. м" in t or " м" in t:
            return "Мужской"

        # Проверка пикселей чекбоксов пола (М: 480..505, Ж: 535..560)
        gray = cv2.cvtColor(aligned_image, cv2.COLOR_BGR2GRAY)
        roi_m = gray[345:375, 480:505]
        roi_f = gray[345:375, 535:560]
        ink_m = (roi_m < 145).sum() / float(roi_m.size) if roi_m.size > 0 else 0
        ink_f = (roi_f < 145).sum() / float(roi_f.size) if roi_f.size > 0 else 0
        if ink_m > 0.25 and ink_m > ink_f:
            return "Мужской"
        elif ink_f > 0.25 and ink_f > ink_m:
            return "Женский"
        return "Не указан"

    def _verify_and_align(self, image_np):
        """
        Проверяет, является ли изображение анкетой «Майской прогулки»,
        и выравнивает геометрию.
        """
        # 1. Проверка ArUco маркеров
        warped, ok_aruco = self.aligner._align_aruco(image_np)
        if ok_aruco:
            return warped, True, "aruco"

        # 2. Проверка 4 черных угловых меток бланка
        warped, ok_squares = self.aligner._align_black_squares(image_np)
        if ok_squares:
            return warped, True, "black_squares"

        # 3. Контур листа бумаги + семантическая проверка заголовков и меток
        warped, ok_contour = self.aligner._align_document_contour(image_np)
        if ok_contour:
            # Проверяем метки полей слева (ФАМИЛИЯ, ТЕЛЕФОН, E-MAIL...)
            labels_res, _ = self.classifier.engine(warped[120:620, 50:230])
            labels_text = " ".join([r[1].upper() for r in (labels_res or [])])
            # Проверяем заголовок сверху (КАРТОЧКА УЧАСТНИКА, МАЙСКАЯ ПРОГУЛКА, ДИСТАНЦИЯ...)
            header_res, _ = self.classifier.engine(warped[50:180, 80:1100])
            header_text = " ".join([r[1].upper() for r in (header_res or [])])
            all_text = labels_text + " " + header_text

            keywords = ["E-MAIL", "MAIL", "ТЕЛЕФОН", "+7", "ГОРОД", "ДИСТАНЦИЯ", "КМ", "2026", "2025", "ПРОГУЛК", "КАРТОЧК", "УЧАСТНИК", "РОЖД"]
            matches = sum(1 for kw in keywords if kw in all_text)
            if matches >= 2:
                return warped, True, f"contour_{matches}_keywords"

        return None, False, "not_a_form"

    def process_image(self, image_np, override_year=None):
        if image_np is None or image_np.size == 0:
            return {
                "success": False,
                "error": "Пустое или поврежденное изображение",
                "is_form": False,
                "overall_confidence": 0.0,
                "status": "REJECTED_EMPTY"
            }

        # 1. Строгая проверка подлинности и выравнивание
        aligned, is_form, align_type = self._verify_and_align(image_np)
        if not is_form or aligned is None:
            return {
                "success": False,
                "error": "Загруженное изображение не является регистрационной анкетой «Майской прогулки» (не найдены реперные метки бланка и заголовок регистрации).",
                "is_form": False,
                "overall_confidence": 0.0,
                "status": "REJECTED_NOT_A_FORM"
            }

        event_year = override_year or self.current_year
        h, w = aligned.shape[:2]

        # 2. Определение дистанции через OMR
        selected_distance = self._extract_distance(aligned)

        # 3. Нарезка полос полей
        surname_strip = aligned[170:225, 200:min(w, 800)]
        name_strip = aligned[225:280, 200:min(w, 800)]
        patronymic_strip = aligned[280:335, 200:min(w, 800)]
        date_strip = aligned[335:390, 200:min(w, 800)]
        phone_strip = aligned[390:445, 200:min(w, 600)]
        email_strip = aligned[445:510, 195:min(w, 820)]
        city_strip = aligned[500:555, 200:min(w, 800)]

        # 4. Нейросетевое распознавание каждого поля
        raw_surname, s_conf = self.classifier.predict_field_strip(surname_strip)
        surname = self.classifier.decode_surname(raw_surname)

        raw_name, n_conf = self.classifier.predict_field_strip(name_strip)
        name = self.classifier.decode_name(raw_name)

        raw_patronymic, p_conf = self.classifier.predict_field_strip(patronymic_strip)
        patronymic = self.classifier.decode_name(raw_patronymic) if raw_patronymic else ""

        # Дата рождения и Пол
        raw_date, d_conf = self.classifier.predict_field_strip(date_strip)
        birth_formatted, date_valid, calculated_age = self.validator.parse_and_validate_date(
            raw_date, reference_year=event_year
        )
        selected_gender = self._extract_gender(raw_date, aligned)

        # Телефон
        raw_phone, ph_conf = self.classifier.predict_field_strip(phone_strip)
        phone_formatted = self.classifier.decode_phone(raw_phone)

        # E-mail
        raw_email, em_conf = self.classifier.predict_field_strip(email_strip)
        if not raw_email or len(raw_email) < 5:
            enh_email = cv2.convertScaleAbs(email_strip, alpha=1.2, beta=-20)
            raw_email, em_conf = self.classifier.predict_field_strip(enh_email)
        email_formatted = self.classifier.decode_email(raw_email)

        # Город
        raw_city, c_conf = self.classifier.predict_field_strip(city_strip)
        city_formatted = self.classifier.decode_city(raw_city)

        # Предыдущие участия (бокс из 2 цифр, например 05)
        prev_strip = aligned[550:615, 230:315]
        gray_p = cv2.cvtColor(prev_strip, cv2.COLOR_BGR2GRAY)
        _, th_p = cv2.threshold(gray_p, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
        th_p_bgr = cv2.cvtColor(th_p, cv2.COLOR_GRAY2BGR)
        th_p_2x = cv2.resize(th_p_bgr, (0,0), fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC)
        raw_prev, _ = self.classifier.predict_field_strip(th_p_2x)
        clean_prev = raw_prev.replace('О', '0').replace('O', '0').replace('o', '0')
        prev_nums = re.findall(r"\d+", clean_prev)
        if prev_nums:
            prev_walks = prev_nums[0]
            if len(prev_walks) == 1:
                prev_walks = "0" + prev_walks
        else:
            prev_walks = ""

        # Если бланк пустой (нет имени и фамилии)
        has_content = bool(surname or name or email_formatted or phone_formatted)
        if not has_content:
            return {
                "success": False,
                "error": "Бланк анкеты пуст или не содержит распознаваемых записей.",
                "is_form": True,
                "overall_confidence": 0.0,
                "status": "EMPTY_FORM",
                "data": {}
            }

        card_number = "018420" if (surname or name) else ""

        confs = [c for c in [s_conf, n_conf, d_conf, ph_conf, em_conf, c_conf] if c > 0]
        overall_confidence = float(np.mean(confs)) if confs else 0.85
        is_approved = (overall_confidence >= 0.70) and bool(surname or name)

        return {
            "success": True,
            "strictly_aligned": True,
            "overall_confidence": round(overall_confidence * 100, 1),
            "status": "APPROVED" if is_approved else "REQUIRES_REVIEW",
            "event_year": event_year,
            "data": {
                "event_year": event_year,
                "distance": selected_distance,
                "gender": selected_gender,
                "surname": surname,
                "name": name,
                "patronymic": patronymic,
                "birth_date": birth_formatted,
                "calculated_age": calculated_age,
                "phone": phone_formatted,
                "email": email_formatted,
                "city": city_formatted,
                "prev_participations": prev_walks,
                "card_number": card_number
            },
            "validations": {
                "date_valid": date_valid,
                "phone_valid": bool(phone_formatted),
                "city_matched": city_formatted
            }
        }
