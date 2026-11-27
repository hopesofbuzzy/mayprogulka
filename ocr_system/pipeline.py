import json
import os
import re
import cv2
import numpy as np

from .aligner import DocumentAligner
from .classifier import DeepLearningOCRClassifier
from .validator import PostValidator

_DEFAULT_DISTANCES = [
    "50 км (Классика)",
    "33 км (Лесной)",
    "18 км (Шарташ)",
    "15 км (Городской)",
]

_DEFAULT_ROWS_ARUCO = {
    "dist": 140,
    "surname": 192,
    "name": 247,
    "patronymic": 302,
    "date": 357,
    "phone": 412,
    "email": 467,
    "city": 522,
    "prev": 577,
    "card": 770,
}

_DEFAULT_ROWS_BLACK_SQUARES = {
    "dist": 147,
    "surname": 207,
    "name": 262,
    "patronymic": 318,
    "date": 370,
    "phone": 425,
    "email": 480,
    "city": 535,
    "prev": 590,
    "card": 800,
}


class FormOCRPipeline:
    """
    Универсальный пайплайн AI-OCR для анкет «Майской прогулки» (старый и новый шаблоны):
    1. Проверка подлинности бланка и выравнивание (ArUco / 4 угловых квадрата / контур листа)
    2. Динамический поиск строк и чекбоксов по печатным меткам бланка
    3. Локальный OMR-анализ чекбоксов с компенсацией неравномерного освещения
    4. Поклеточное извлечение символов без рамок ячеек
    5. Гибридное распознавание: дообученная HandwrittenBoxNet ONNX + PP-OCRv6 Medium + RapidOCR
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

    def _get_distance_labels(self):
        cfg_dists = self.config.get("distances") or []
        labels = [d.get("label", "") for d in cfg_dists if isinstance(d, dict) and d.get("label")]
        return labels[:4] if len(labels) >= 4 else _DEFAULT_DISTANCES

    @staticmethod
    def _local_checkbox_ink(gray, x, y, w, h):
        H, W = gray.shape
        rx1, ry1 = max(0, x - 14), max(0, y - 14)
        rx2, ry2 = min(W, x + w + 14), min(H, y + h + 14)
        patch = gray[ry1:ry2, rx1:rx2]
        bg = float(np.percentile(patch, 88)) if patch.size else 255.0
        pad = 4 if min(w, h) >= 18 else 2
        inner = gray[max(0, y + pad) : min(H, y + h - pad), max(0, x + pad) : min(W, x + w - pad)].astype(np.float32)
        if inner.size == 0:
            return 0.0
        diff = bg - inner
        thresh = max(35.0, bg * 0.20)
        return float((diff > thresh).sum() / inner.size)

    @staticmethod
    def _find_checkbox_squares(aligned, y1, y2, x1, x2, min_dx=20):
        H, W = aligned.shape[:2]
        y1, y2 = max(0, y1), min(H, y2)
        x1, x2 = max(0, x1), min(W, x2)
        crop = aligned[y1:y2, x1:x2]
        if crop.size == 0:
            return []
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        bin_img = cv2.adaptiveThreshold(
            gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 15, 5
        )
        contours, _ = cv2.findContours(bin_img, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        found = []
        for c in contours:
            bx, by, bw, bh = cv2.boundingRect(c)
            if 18 <= bw <= 34 and 18 <= bh <= 34:
                aspect = bw / float(bh)
                if 0.78 <= aspect <= 1.28:
                    found.append((x1 + bx, y1 + by, bw, bh))
        found.sort(key=lambda t: (t[0], -t[2] * t[3]))
        dedup = []
        for f in found:
            if not dedup or abs(f[0] - dedup[-1][0]) > min_dx:
                dedup.append(f)
        return dedup

    def _detect_row_anchors(self, aligned, align_type):
        defaults = dict(
            _DEFAULT_ROWS_BLACK_SQUARES if align_type == "black_squares" else _DEFAULT_ROWS_ARUCO
        )
        res, _ = self.classifier.engine(aligned[:, 30:270])
        if not res:
            return defaults

        label_rules = [
            ("dist", ["ДИСТАНЦ"]),
            ("surname", ["ФАМИЛ"]),
            ("name", ["ИМЯ"]),
            ("patronymic", ["ОТЧЕСТВ"]),
            ("date", ["ДАТАРОЖ", "РОЖД"]),
            ("phone", ["ТЕЛЕФОН"]),
            ("email", ["EMAIL", "MAIL"]),
            ("city", ["ГОРОД"]),
            ("prev", ["РАНЕЕ", "УЧАСТИ"]),
            ("card", ["№КАРТ", "КАРТЫ"]),
        ]

        detected = {}
        for box, txt, _ in res:
            norm = re.sub(r"[^А-ЯЁA-Z0-9№]", "", txt.upper())
            yc = int(round(np.mean([pt[1] for pt in box])))
            if yc < 100 or yc > 950:
                continue
            for key, patterns in label_rules:
                if key in detected:
                    continue
                if key == "name" and not (norm == "ИМЯ" or norm.startswith("ИМЯ")):
                    continue
                if key == "card" and yc < 700:
                    continue
                if key == "date" and yc > 500:
                    continue
                if any(p in norm for p in patterns):
                    detected[key] = yc
                    break

        seq = ["surname", "name", "patronymic", "date", "phone", "email", "city", "prev"]
        known_idx = [(i, detected[k]) for i, k in enumerate(seq) if k in detected]
        if len(known_idx) >= 2:
            i0, y0 = known_idx[0]
            i1, y1 = known_idx[-1]
            step = (y1 - y0) / float(i1 - i0)
            if 45.0 <= step <= 65.0:
                for i, k in enumerate(seq):
                    if k not in detected:
                        detected[k] = int(round(y0 + (i - i0) * step))
                if "dist" not in detected:
                    detected["dist"] = int(round(detected["surname"] - step))

        for k, v in defaults.items():
            if k not in detected:
                detected[k] = v

        return detected

    def _extract_distance(self, aligned_image, dist_y, align_type):
        labels = self._get_distance_labels()
        gray = cv2.cvtColor(aligned_image, cv2.COLOR_BGR2GRAY)

        squares = self._find_checkbox_squares(
            aligned_image, dist_y - 30, dist_y + 30, 150, 1100, min_dx=120
        )
        if len(squares) == 4:
            boxes = squares
        else:
            band_y1 = max(0, dist_y - 28)
            band_y2 = min(aligned_image.shape[0], dist_y + 28)
            res, _ = self.classifier.engine(aligned_image[band_y1:band_y2, 180:1120])
            xs = []
            for lbl in labels:
                token = re.sub(r"\D", "", lbl.split()[0])
                match_x = None
                for box, txt, _ in (res or []):
                    if token and token in txt:
                        x_left = int(min(pt[0] for pt in box)) + 180
                        match_x = max(160, x_left - 34)
                        break
                if match_x is not None:
                    xs.append(match_x)
            if len(xs) != 4:
                xs = [199, 420, 630, 841] if align_type == "black_squares" else [210, 440, 670, 900]
            boxes = [(x, dist_y - 13, 25, 25) for x in xs]

        ratios = [self._local_checkbox_ink(gray, x, y, w, h) for (x, y, w, h) in boxes]
        best_idx = int(np.argmax(ratios))
        sorted_r = sorted(ratios, reverse=True)
        max_r = sorted_r[0]
        second_r = sorted_r[1] if len(sorted_r) > 1 else 0.0

        if max_r >= 0.24 and (max_r - second_r >= 0.08 or max_r >= 0.45):
            return labels[best_idx]
        return "Не выбрана"

    def _extract_gender(self, aligned_image, date_y, align_type):
        gray = cv2.cvtColor(aligned_image, cv2.COLOR_BGR2GRAY)
        squares = self._find_checkbox_squares(
            aligned_image, date_y - 30, date_y + 30, 540, 800, min_dx=35
        )
        if len(squares) >= 2:
            box_m, box_f = squares[0], squares[1]
            for i in range(len(squares) - 1):
                dx = squares[i + 1][0] - squares[i][0]
                if 45 <= dx <= 110:
                    box_m, box_f = squares[i], squares[i + 1]
                    break
        else:
            box_m = (590, date_y - 13, 25, 25)
            box_f = (662, date_y - 13, 25, 25)

        ink_m = self._local_checkbox_ink(gray, *box_m)
        ink_f = self._local_checkbox_ink(gray, *box_f)

        if ink_m >= 0.22 and ink_m > ink_f + 0.08:
            return "Мужской"
        if ink_f >= 0.22 and ink_f > ink_m + 0.08:
            return "Женский"
        return "Не указан"

    @staticmethod
    def _find_boxes_in_row(strip_bgr):
        gray = cv2.cvtColor(strip_bgr, cv2.COLOR_BGR2GRAY)
        bin_img = cv2.adaptiveThreshold(
            gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 15, 5
        )
        contours, _ = cv2.findContours(bin_img, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        boxes = []
        for c in contours:
            x, y, w, h = cv2.boundingRect(c)
            if 18 <= w <= 45 and 22 <= h <= 52 and 0.55 <= w / float(h) <= 1.25:
                boxes.append((x, y, w, h))
        boxes.sort(key=lambda b: (b[0], -b[2] * b[3]))
        dedup = []
        for b in boxes:
            if not dedup or abs(b[0] - dedup[-1][0]) > 15:
                dedup.append(b)
        return dedup

    @staticmethod
    def _extract_clean_cells(strip_bgr, boxes, pad=2, allow_dot=False):
        cells = []
        for (bx, by, bw, bh) in boxes:
            cell = strip_bgr[by + pad : by + bh - pad, bx + pad : bx + bw - pad]
            if cell.size == 0:
                cells.append(None)
                continue
            g = cv2.cvtColor(cell, cv2.COLOR_BGR2GRAY)
            bg = float(np.percentile(g, 88))
            diff = bg - g.astype(np.float32)
            core = diff[2:-4, 2:-2] if diff.shape[0] > 8 and diff.shape[1] > 6 else diff
            ink_thresh = max(40.0, bg * 0.21)
            ink_ratio = (core > ink_thresh).sum() / max(core.size, 1)

            dot_region = diff[int(diff.shape[0] * 0.35) : -1, 2:-2] if diff.shape[0] > 10 and diff.shape[1] > 6 else diff
            dot_cnt = (dot_region > ink_thresh * 1.1).sum()
            has_dot = allow_dot and (dot_cnt >= 4)

            if ink_ratio <= 0.018 and not has_dot:
                cells.append(None)
                continue

            norm = np.clip(255.0 - diff * (255.0 / max(bg * 0.65, 65.0)), 0, 255).astype(np.uint8)
            norm[diff < ink_thresh * 0.65] = 255
            cells.append(cv2.cvtColor(norm, cv2.COLOR_GRAY2BGR))
        return cells

    @staticmethod
    def _pack_cells(cells, spacer_w=5):
        valid = [cv2.resize(c, (28, 36)) for c in cells if c is not None]
        if not valid:
            return None
        spacer = np.full((36, spacer_w, 3), 255, dtype=np.uint8)
        parts = []
        for i, c in enumerate(valid):
            if i > 0:
                parts.append(spacer)
            parts.append(c)
        packed = np.hstack(parts)
        return cv2.copyMakeBorder(
            packed, 14, 14, 18, 18, cv2.BORDER_CONSTANT, value=(255, 255, 255)
        )

    def _read_cyrillic_field(self, aligned, y_center, x1, x2):
        H, W = aligned.shape[:2]
        strip = aligned[max(0, y_center - 30) : min(H, y_center + 30), max(0, x1) : min(W, x2)]
        if strip.size == 0:
            return "", 0.0

        boxes = self._find_boxes_in_row(strip)
        if not boxes:
            return self.classifier.predict_field_strip(strip)

        cells_med = self._extract_clean_cells(strip, boxes, pad=2, allow_dot=False)
        packed = self._pack_cells(cells_med, spacer_w=5)
        if packed is None:
            return "", 0.0
        med_txt, med_conf = self.classifier.predict_packed_cells(packed)

        if self.classifier.char_sess is not None:
            cells_hw = self._extract_clean_cells(strip, boxes, pad=3, allow_dot=False)
            hw_txt, hw_probs, hw_conf = self.classifier.predict_cells_char_onnx(
                cells_hw, alphabet_mode="cyrillic"
            )
            fused = self.classifier.fuse_cyrillic_with_handwritten(med_txt, hw_txt, hw_probs)
            if fused:
                return fused, max(med_conf, hw_conf)

        return med_txt, med_conf

    def _read_digit_field(self, aligned, y_center, x1, x2, min_boxes=1):
        H, W = aligned.shape[:2]
        strip = aligned[max(0, y_center - 30) : min(H, y_center + 30), max(0, x1) : min(W, x2)]
        if strip.size == 0:
            return "", 0.0

        boxes = self._find_boxes_in_row(strip)
        if len(boxes) >= min_boxes:
            if self.classifier.char_sess is not None:
                cells_hw = self._extract_clean_cells(strip, boxes, pad=3, allow_dot=False)
                if not any(c is not None for c in cells_hw):
                    return "", 0.0
                hw_txt, _, hw_conf = self.classifier.predict_cells_char_onnx(
                    cells_hw, alphabet_mode="digits"
                )
                if hw_txt:
                    return hw_txt, hw_conf

            cells_med = self._extract_clean_cells(strip, boxes, pad=2, allow_dot=False)
            packed = self._pack_cells(cells_med, spacer_w=5)
            if packed is None:
                return "", 0.0
            return self.classifier.predict_packed_cells(packed)

        return self.classifier.predict_field_strip(strip)

    def _read_email_field(self, aligned, y_center, x1, x2):
        H, W = aligned.shape[:2]
        strip = aligned[max(0, y_center - 30) : min(H, y_center + 30), max(0, x1) : min(W, x2)]
        if strip.size == 0:
            return "", "", "", 0.0, 0.0

        boxes = self._find_boxes_in_row(strip)
        if boxes:
            cells = self._extract_clean_cells(strip, boxes, pad=2, allow_dot=True)
            packed = self._pack_cells(cells, spacer_w=3)
            if packed is None:
                return "", "", "", 0.0, 0.0
            txt, conf = self.classifier.predict_packed_cells(packed)
            lat_txt, lat_conf = self.classifier.predict_packed_cells(packed, use_latin=True)
            hw_txt, hw_probs, hw_conf = "", None, 0.0
            if self.classifier.char_sess is not None:
                cells_hw = self._extract_clean_cells(strip, boxes, pad=3, allow_dot=True)
                hw_txt, hw_probs, hw_conf = self.classifier.predict_cells_char_onnx(
                    cells_hw, alphabet_mode="email"
                )
            return txt, lat_txt, hw_txt, hw_probs, hw_conf, max(conf, lat_conf, hw_conf)

        txt, conf = self.classifier.predict_field_strip(strip)
        return txt, "", "", None, 0.0, conf

    def _check_form_keywords(self, warped):
        labels_res, _ = self.classifier.engine(warped[110:630, 40:250])
        labels_text = " ".join([r[1].upper() for r in (labels_res or [])])
        header_res, _ = self.classifier.engine(warped[30:180, 80:1100])
        header_text = " ".join([r[1].upper() for r in (header_res or [])])
        all_text = labels_text + " " + header_text

        keywords = [
            "E-MAIL", "MAIL", "ТЕЛЕФОН", "+7", "ГОРОД", "ДИСТАНЦ",
            "КМ", "2026", "2025", "ПРОГУЛК", "КАРТОЧК", "УЧАСТНИК", "РОЖД", "ФАМИЛ",
        ]
        return sum(1 for kw in keywords if kw in all_text)

    def _verify_and_align(self, image_np):
        warped, ok_aruco = self.aligner._align_aruco(image_np)
        if ok_aruco:
            return warped, True, "aruco"

        warped, ok_squares = self.aligner._align_black_squares(image_np)
        if ok_squares:
            return warped, True, "black_squares"

        warped, ok_contour = self.aligner._align_document_contour(image_np)
        if ok_contour:
            matches = self._check_form_keywords(warped)
            if matches >= 2:
                return warped, True, f"contour_{matches}_keywords"

        resized = cv2.resize(image_np, (self.aligner.target_w, self.aligner.target_h))
        matches = self._check_form_keywords(resized)
        if matches >= 3:
            return resized, True, f"resized_{matches}_keywords"

        return None, False, "not_a_form"

    def process_image(self, image_np, override_year=None):
        if image_np is None or image_np.size == 0:
            return {
                "success": False,
                "error": "Пустое или поврежденное изображение",
                "is_form": False,
                "overall_confidence": 0.0,
                "status": "REJECTED_EMPTY",
            }

        aligned, is_form, align_type = self._verify_and_align(image_np)
        if not is_form or aligned is None:
            return {
                "success": False,
                "error": "Загруженное изображение не является регистрационной анкетой «Майской прогулки» (не найдены реперные метки бланка и заголовок регистрации).",
                "is_form": False,
                "overall_confidence": 0.0,
                "status": "REJECTED_NOT_A_FORM",
            }

        event_year = override_year or self.current_year
        rows = self._detect_row_anchors(aligned, align_type)

        selected_distance = self._extract_distance(aligned, rows["dist"], align_type)
        selected_gender = self._extract_gender(aligned, rows["date"], align_type)

        raw_surname, s_conf = self._read_cyrillic_field(aligned, rows["surname"], 195, 1030)
        surname = self.classifier.decode_surname(raw_surname)

        raw_name, n_conf = self._read_cyrillic_field(aligned, rows["name"], 195, 1030)
        name = self.classifier.decode_name(raw_name)

        raw_patronymic, p_conf = self._read_cyrillic_field(aligned, rows["patronymic"], 195, 1030)
        patronymic = self.classifier.decode_name(raw_patronymic) if raw_patronymic else ""

        raw_date, d_conf = self._read_digit_field(aligned, rows["date"], 195, 535, min_boxes=4)
        birth_formatted, date_valid, calculated_age = self.validator.parse_and_validate_date(
            raw_date, reference_year=event_year
        )

        raw_phone, ph_conf = self._read_digit_field(aligned, rows["phone"], 195, 630, min_boxes=4)
        phone_formatted = self.classifier.decode_phone(raw_phone)
        _, phone_valid = self.validator.validate_phone(raw_phone)

        raw_email, raw_email_lat, raw_email_hw, hw_em_probs, hw_em_conf, em_conf = self._read_email_field(
            aligned, rows["email"], 195, 1060
        )
        email_formatted = self.classifier.decode_email(
            raw_email, raw_email_lat, raw_email_hw, hw_em_conf, hw_em_probs
        )

        raw_city, c_conf = self._read_cyrillic_field(aligned, rows["city"], 195, 920)
        city_formatted = self.classifier.decode_city(raw_city)

        raw_prev, _ = self._read_digit_field(aligned, rows["prev"], 215, 345)
        clean_prev = self.classifier.normalize_digits(raw_prev)
        prev_nums = re.findall(r"\d+", clean_prev)
        prev_walks = str(int(prev_nums[0])) if prev_nums else ""

        raw_card, _ = self._read_digit_field(aligned, rows["card"], 195, 460)
        card_number = self.classifier.normalize_digits(raw_card)[:6]

        has_content = bool(surname or name or email_formatted or phone_formatted)
        if not has_content:
            return {
                "success": False,
                "error": "Бланк анкеты пуст или не содержит распознаваемых записей.",
                "is_form": True,
                "overall_confidence": 0.0,
                "status": "EMPTY_FORM",
                "data": {},
            }

        confs = [c for c in [s_conf, n_conf, p_conf, d_conf, ph_conf, em_conf, c_conf] if c > 0]
        overall_confidence = float(np.mean(confs)) if confs else 0.0
        is_approved = (
            overall_confidence >= 0.70
            and bool(surname or name)
            and date_valid
            and phone_valid
        )

        return {
            "success": True,
            "strictly_aligned": True,
            "align_type": align_type,
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
                "card_number": card_number,
            },
            "validations": {
                "date_valid": date_valid,
                "phone_valid": phone_valid,
                "city_matched": city_formatted,
            },
        }
