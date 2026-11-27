import json
import os
import re
import cv2
import numpy as np

from .aligner import DocumentAligner
from .classifier import DeepLearningOCRClassifier, _LAT_TO_CYR
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
    4. Сеточно-ориентированная поклеточная сегментация (восстановление пропущенных рамок и нормировка чернил)
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
    def _ink_intensity_map(patch_bgr_or_gray):
        if patch_bgr_or_gray.ndim == 2:
            return patch_bgr_or_gray.astype(np.float32)
        g = cv2.cvtColor(patch_bgr_or_gray, cv2.COLOR_BGR2GRAY).astype(np.float32)
        r = patch_bgr_or_gray[:, :, 2].astype(np.float32)
        # Синяя шариковая ручка заметно темнее в красном канале при том же сером фоне бумаги
        return np.minimum(g, 0.35 * g + 0.65 * r)

    @classmethod
    def _local_checkbox_ink(cls, img, x, y, w, h):
        H, W = img.shape[:2]
        rx1, ry1 = max(0, x - 14), max(0, y - 14)
        rx2, ry2 = min(W, x + w + 14), min(H, y + h + 14)
        patch = cls._ink_intensity_map(img[ry1:ry2, rx1:rx2])
        bg = float(np.percentile(patch, 88)) if patch.size else 255.0
        pad = 3 if min(w, h) >= 18 else 2
        inner_raw = img[max(0, y + pad) : min(H, y + h - pad), max(0, x + pad) : min(W, x + w - pad)]
        if inner_raw.size == 0:
            return 0.0
        inner = cls._ink_intensity_map(inner_raw)
        diff = bg - inner
        thresh = max(22.0, min(32.0, bg * 0.12))
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

        bin_main = cv2.adaptiveThreshold(
            gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 15, 5
        )
        bin_soft = cv2.adaptiveThreshold(
            gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 15, 2
        )
        bin_soft = cv2.morphologyEx(bin_soft, cv2.MORPH_CLOSE, np.ones((2, 2), np.uint8))

        found = []
        for bin_img in (bin_main, bin_soft):
            contours, _ = cv2.findContours(bin_img, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
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
            elif f[2] * f[3] > dedup[-1][2] * dedup[-1][3]:
                dedup[-1] = f
        return dedup

    def _detect_row_anchors(self, aligned, align_type):
        defaults = dict(
            _DEFAULT_ROWS_BLACK_SQUARES if align_type == "black_squares" else _DEFAULT_ROWS_ARUCO
        )
        res, _ = self.classifier.engine(aligned[:, 20:285])
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
        for entry in res:
            if not isinstance(entry, (list, tuple)) or len(entry) < 2:
                continue
            box, txt = entry[0], str(entry[1])
            norm_lat = re.sub(r"[^А-ЯЁA-Z0-9№]", "", txt.upper())
            norm_cyr = re.sub(r"[^А-ЯЁA-Z0-9№]", "", txt.upper().translate(_LAT_TO_CYR))
            yc = int(round(np.mean([pt[1] for pt in box])))
            if yc < 100 or yc > 950:
                continue
            for key, patterns in label_rules:
                if key in detected:
                    continue
                norm = norm_lat if key == "email" else norm_cyr
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
                if "card" not in detected:
                    ratio = 3.85 if align_type == "black_squares" else 3.50
                    detected["card"] = int(round(detected["prev"] + step * ratio))

        for k, v in defaults.items():
            if k not in detected:
                detected[k] = v

        return detected

    def _extract_distance(self, aligned_image, dist_y, align_type):
        labels = self._get_distance_labels()

        squares = self._find_checkbox_squares(
            aligned_image, dist_y - 34, dist_y + 34, 150, 1100, min_dx=120
        )
        if len(squares) == 4:
            boxes = squares
        else:
            xs_def = [199, 420, 630, 841] if align_type == "black_squares" else [210, 440, 670, 900]
            step_def = 214.0 if align_type == "black_squares" else 230.0
            band_y1 = max(0, dist_y - 30)
            band_y2 = min(aligned_image.shape[0], dist_y + 30)
            res, _ = self.classifier.engine(aligned_image[band_y1:band_y2, 180:1120])

            # Если нашлись 1-3 квадрата чекбоксов, восстанавливаем 4 слота по стандартному шагу
            slots = [None] * 4
            for sq in squares:
                idx = int(np.argmin([abs(sq[0] - xd) for xd in xs_def]))
                slots[idx] = sq

            if 1 <= len(squares) < 4:
                ref_idx, ref_sq = next((i, s) for i, s in enumerate(slots) if s is not None)
                bw, bh, ry = ref_sq[2], ref_sq[3], ref_sq[1]
                for i in range(4):
                    if slots[i] is None:
                        slots[i] = (int(round(ref_sq[0] + (i - ref_idx) * step_def)), ry, bw, bh)
                boxes = slots
            else:
                xs = []
                for lbl in labels:
                    token = re.sub(r"\D", "", lbl.split()[0])
                    match_x = None
                    for entry in (res or []):
                        if not isinstance(entry, (list, tuple)) or len(entry) < 2:
                            continue
                        box, txt = entry[0], str(entry[1])
                        if token and token in txt:
                            x_left = int(min(pt[0] for pt in box)) + 180
                            match_x = max(160, x_left - 34)
                            break
                    if match_x is not None:
                        xs.append(match_x)
                if len(xs) != 4:
                    xs = xs_def
                boxes = [(x, dist_y - 13, 25, 25) for x in xs]

        ratios = [self._local_checkbox_ink(aligned_image, x, y, w, h) for (x, y, w, h) in boxes]
        best_idx = int(np.argmax(ratios))
        sorted_r = sorted(ratios, reverse=True)
        max_r = sorted_r[0]
        second_r = sorted_r[1] if len(sorted_r) > 1 else 0.0

        if max_r >= 0.085 and (max_r - second_r >= 0.045 or max_r >= 0.25):
            return labels[best_idx]
        return "Не выбрана"

    def _extract_gender(self, aligned_image, date_y, align_type):
        squares = self._find_checkbox_squares(
            aligned_image, date_y - 34, date_y + 34, 540, 820, min_dx=35
        )
        if len(squares) >= 2:
            box_m, box_f = squares[0], squares[1]
            for i in range(len(squares) - 1):
                dx = squares[i + 1][0] - squares[i][0]
                if 45 <= dx <= 110:
                    box_m, box_f = squares[i], squares[i + 1]
                    break
        elif len(squares) == 1:
            sq = squares[0]
            if sq[0] < 628:
                box_m = sq
                box_f = (sq[0] + 74, sq[1], sq[2], sq[3])
            else:
                box_m = (sq[0] - 74, sq[1], sq[2], sq[3])
                box_f = sq
        else:
            box_m = (590, date_y - 13, 25, 25)
            box_f = (664, date_y - 13, 25, 25)

        ink_m = self._local_checkbox_ink(aligned_image, *box_m)
        ink_f = self._local_checkbox_ink(aligned_image, *box_f)

        if ink_m >= 0.085 and ink_m > ink_f + 0.040:
            return "Мужской"
        if ink_f >= 0.085 and ink_f > ink_m + 0.040:
            return "Женский"
        return "Не указан"

    @staticmethod
    def _find_boxes_in_row(strip_bgr):
        gray = cv2.cvtColor(strip_bgr, cv2.COLOR_BGR2GRAY)

        bin_main = cv2.adaptiveThreshold(
            gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 15, 5
        )
        bin_soft = cv2.adaptiveThreshold(
            gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 15, 2
        )
        bin_soft = cv2.morphologyEx(bin_soft, cv2.MORPH_CLOSE, np.ones((1, 3), np.uint8))
        bin_soft = cv2.morphologyEx(bin_soft, cv2.MORPH_CLOSE, np.ones((3, 1), np.uint8))

        candidates = []
        for priority, bin_img in ((1, bin_main), (0, bin_soft)):
            contours, _ = cv2.findContours(bin_img, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
            for c in contours:
                x, y, w, h = cv2.boundingRect(c)
                if 18 <= w <= 46 and 22 <= h <= 54 and 0.55 <= w / float(h) <= 1.25:
                    candidates.append((x, y, w, h, priority))

        candidates.sort(key=lambda b: (b[0], -b[4], -b[2] * b[3]))
        dedup = []
        for x, y, w, h, prio in candidates:
            if not dedup or abs(x - dedup[-1][0]) > 16:
                dedup.append((x, y, w, h, prio))
            else:
                px, py, pw, ph, pprio = dedup[-1]
                if prio > pprio or (prio == pprio and w * h > pw * ph):
                    dedup[-1] = (x, y, w, h, prio)

        boxes_out = [(x, y, w, h) for (x, y, w, h, _) in dedup]

        # Отбрасываем случайные замкнутые буквы ('О', '0'), если по строке ясна геометрия ячеек
        if len(boxes_out) >= 3:
            w_med = float(np.median([b[2] for b in boxes_out]))
            h_med = float(np.median([b[3] for b in boxes_out]))
            y_med = float(np.median([b[1] + b[3] * 0.5 for b in boxes_out]))
            filtered = [
                b
                for b in boxes_out
                if 0.78 * w_med <= b[2] <= 1.25 * w_med
                and 0.78 * h_med <= b[3] <= 1.25 * h_med
                and abs((b[1] + b[3] * 0.5) - y_med) <= 10.0
            ]
            if len(filtered) >= 2:
                return filtered
        return boxes_out

    @staticmethod
    def _estimate_step(boxes, default_step=32.3):
        steps = []
        for i in range(len(boxes)):
            for j in range(i + 1, min(len(boxes), i + 6)):
                dx = boxes[j][0] - boxes[i][0]
                k = int(round(dx / default_step))
                if k >= 1:
                    s = dx / float(k)
                    if 27.0 <= s <= 41.0:
                        steps.append(s)
        return float(np.median(steps)) if steps else float(default_step)

    @classmethod
    def _estimate_page_grid(cls, aligned, rows, align_type):
        """
        Оценивает единую координатную сетку коробочек (x0, step, bw, bh) по длинным строкам бланка.
        Это позволяет восстанавливать пропущенные/разорванные ячейки даже при засветке или сжатии скана.
        """
        H, W = aligned.shape[:2]
        default_step = 33.0 if align_type == "black_squares" else 32.3
        x1 = 195
        x2 = min(W, 1060)

        all_row_boxes = []
        first_xs = []
        steps = []
        bws = []
        bhs = []

        for key in ("surname", "name", "patronymic", "email", "city", "phone"):
            yc = rows[key]
            strip = aligned[max(0, yc - 36) : min(H, yc + 36), x1:x2]
            if strip.size == 0:
                continue
            raw = cls._find_boxes_in_row(strip)
            # Переводим x в глобальные координаты aligned
            gboxes = [(x1 + bx, by, bw, bh) for (bx, by, bw, bh) in raw]
            if len(gboxes) >= 3:
                all_row_boxes.append((key, gboxes))
                s = cls._estimate_step(gboxes, default_step)
                steps.append(s)
                bws.extend(b[2] for b in gboxes)
                bhs.extend(b[3] for b in gboxes)
                if gboxes[0][0] <= 265:
                    first_xs.append(gboxes[0][0])

        if not steps:
            return None

        grid_step = float(np.median(steps))
        bw_med = int(round(np.median(bws)))
        bh_med = int(round(np.median(bhs)))

        if first_xs:
            # Находим самую левую устойчивую колонку (отбрасывая единичный шум слева, если есть)
            first_xs.sort()
            # Группируем значения, близкие к самому левому реальному столбцу
            x0_cands = [x for x in first_xs if abs(x - first_xs[0]) <= 12]
            if len(x0_cands) == 1 and len(first_xs) >= 3 and first_xs[1] - first_xs[0] > 18:
                x0_cands = [x for x in first_xs[1:] if abs(x - first_xs[1]) <= 12]
            grid_x0 = float(np.median(x0_cands))
        else:
            grid_x0 = 218.0 if align_type == "black_squares" else 217.0

        return {
            "x0": grid_x0,
            "step": grid_step,
            "bw": bw_med,
            "bh": bh_med,
        }

    @staticmethod
    def _snap_boxes_to_offsets(gboxes, rel_offsets, approx_x0, tol_x0):
        cand_x0s = []
        for (bx, _, _, _) in gboxes:
            for r in rel_offsets:
                cx0 = bx - r
                if abs(cx0 - approx_x0) <= tol_x0:
                    cand_x0s.append(cx0)
        if not cand_x0s:
            cand_x0s = [approx_x0]

        best_score = None
        best_x0 = approx_x0
        best_matches = {}
        for cx0 in cand_x0s:
            matches = {}
            for b in gboxes:
                dists = [abs(b[0] - (cx0 + r)) for r in rel_offsets]
                k = int(np.argmin(dists))
                err = dists[k]
                if err <= 6.5 and (k not in matches or err < matches[k][1]):
                    matches[k] = (b, err)
            if not matches:
                continue
            err_sum = sum(v[1] for v in matches.values())
            score = (len(matches), -err_sum - 0.08 * abs(cx0 - approx_x0))
            if best_score is None or score > best_score:
                best_score = score
                best_x0 = cx0
                best_matches = {k: v[0] for k, v in matches.items()}
        return best_score, best_x0, best_matches

    @staticmethod
    def _materialize_grid(rel_offsets, best_x0, best_matches, x1_offset, sw, by_med, bw_med, bh_med):
        out = []
        for k, r in enumerate(rel_offsets):
            if k in best_matches:
                bx, by, bw, bh = best_matches[k]
                out.append((max(0, bx - x1_offset), by, bw, bh))
            else:
                gx = int(round(best_x0 + r))
                lx = gx - x1_offset
                if 0 <= lx < sw - 8:
                    out.append((lx, by_med, bw_med, bh_med))
        return out

    @classmethod
    def _fit_uniform_grid(
        cls,
        raw_boxes,
        x1_offset,
        expected_count,
        strip_shape,
        page_grid=None,
        x_offset_from_grid=0.0,
        default_step=32.3,
    ):
        """
        Выравнивает найденные контуры коробочек на регулярную сетку длиной expected_count
        и интерполирует любые пропущенные/повреждённые рамки.
        """
        sh, sw = strip_shape[:2]
        gboxes = [(x1_offset + bx, by, bw, bh) for (bx, by, bw, bh) in raw_boxes]

        if page_grid is not None and x_offset_from_grid is not None:
            approx_x0 = page_grid["x0"] + x_offset_from_grid
            approx_step = page_grid["step"]
            tol_x0 = 20.0
        else:
            approx_x0 = 218.0 + (x_offset_from_grid or 0.0)
            approx_step = default_step
            tol_x0 = 55.0

        if not gboxes:
            if page_grid is None:
                return raw_boxes
            rel = [k * approx_step for k in range(expected_count)]
            by_med = max(0, (sh - page_grid["bh"]) // 2)
            return cls._materialize_grid(
                rel, approx_x0, {}, x1_offset, sw, by_med, page_grid["bw"], page_grid["bh"]
            )

        step = cls._estimate_step(gboxes, approx_step) if len(gboxes) >= 2 else approx_step
        bw_med = int(round(np.median([b[2] for b in gboxes])))
        bh_med = int(round(np.median([b[3] for b in gboxes])))
        by_med = int(round(np.median([b[1] for b in gboxes])))
        rel = [k * step for k in range(expected_count)]

        _, best_x0, best_matches = cls._snap_boxes_to_offsets(gboxes, rel, approx_x0, tol_x0)
        if not best_matches:
            return raw_boxes

        return cls._materialize_grid(
            rel, best_x0, best_matches, x1_offset, sw, by_med, bw_med, bh_med
        )

    @classmethod
    def _fit_date_grid(cls, raw_boxes, x1_offset, strip_shape, page_grid=None, default_step=32.3):
        """
        Восстанавливает точную 8-ячеечную сетку даты рождения (ДД . ММ . ГГГГ),
        отсекая чекбоксы пола справа.
        """
        sh, sw = strip_shape[:2]
        gboxes = [(x1_offset + bx, by, bw, bh) for (bx, by, bw, bh) in raw_boxes]

        approx_x0 = page_grid["x0"] if page_grid is not None else 218.0
        step = page_grid["step"] if page_grid is not None else default_step

        # Отбрасываем квадраты пола ('М' / 'Ж'), расположенные заметно правее 8-й ячейки даты
        gboxes = [b for b in gboxes if b[0] <= approx_x0 + 10.2 * step]
        if len(gboxes) > 8:
            cut = len(gboxes)
            for i in range(len(gboxes) - 1):
                if gboxes[i + 1][0] - gboxes[i][0] > 72:
                    cut = i + 1
                    break
            gboxes = gboxes[:cut]

        def _date_rel(dot_gap):
            return [
                0.0,
                step,
                2.0 * step + dot_gap,
                3.0 * step + dot_gap,
                4.0 * step + 2.0 * dot_gap,
                5.0 * step + 2.0 * dot_gap,
                6.0 * step + 2.0 * dot_gap,
                7.0 * step + 2.0 * dot_gap,
            ]

        if not gboxes:
            if page_grid is None:
                return raw_boxes
            by_med = max(0, (sh - page_grid["bh"]) // 2)
            return cls._materialize_grid(
                _date_rel(18.0), approx_x0, {}, x1_offset, sw, by_med, page_grid["bw"], page_grid["bh"]
            )

        if len(gboxes) >= 2 and page_grid is None:
            adj = [gboxes[i + 1][0] - gboxes[i][0] for i in range(len(gboxes) - 1) if 27 <= gboxes[i + 1][0] - gboxes[i][0] <= 40]
            if adj:
                step = float(np.median(adj))

        bw_med = int(round(np.median([b[2] for b in gboxes])))
        bh_med = int(round(np.median([b[3] for b in gboxes])))
        by_med = int(round(np.median([b[1] for b in gboxes])))
        tol_x0 = 20.0 if page_grid is not None else 55.0

        best_score = None
        best_x0 = approx_x0
        best_rel = None
        best_matches = {}
        for dot_gap in (16.5, 18.5, 20.5):
            rel = _date_rel(dot_gap)
            score, cx0, matches = cls._snap_boxes_to_offsets(gboxes, rel, approx_x0, tol_x0)
            if score is not None and (best_score is None or score > best_score):
                best_score = score
                best_x0 = cx0
                best_rel = rel
                best_matches = matches

        if not best_matches or best_rel is None:
            return [(max(0, b[0] - x1_offset), b[1], b[2], b[3]) for b in gboxes]

        return cls._materialize_grid(
            best_rel, best_x0, best_matches, x1_offset, sw, by_med, bw_med, bh_med
        )

    @classmethod
    def _extract_clean_cells(cls, strip_bgr, boxes, pad=2, allow_dot=False):
        cells = []
        sh, sw = strip_bgr.shape[:2]
        for (bx, by, bw, bh) in boxes:
            y1 = max(0, by + pad)
            y2 = min(sh, by + bh - pad)
            x1 = max(0, bx + pad)
            x2 = min(sw, bx + bw - pad)
            cell = strip_bgr[y1:y2, x1:x2]
            if cell.size == 0 or cell.shape[0] < 8 or cell.shape[1] < 6:
                cells.append(None)
                continue

            g = cv2.cvtColor(cell, cv2.COLOR_BGR2GRAY).astype(np.float32)
            bg_g = float(np.percentile(g, 88))
            diff_g = np.maximum(0.0, bg_g - g)

            ink_gray = cls._ink_intensity_map(cell)
            bg_ink = float(np.percentile(ink_gray, 88))
            diff_ink = np.maximum(0.0, bg_ink - ink_gray)

            ch, cw = diff_g.shape
            core_ink = diff_ink[2:-5, 2:-2] if ch > 10 and cw > 6 else diff_ink
            core_g = diff_g[2:-5, 2:-2] if ch > 10 and cw > 6 else diff_g

            noise_sig = max(0.0, float(np.percentile(core_ink, 75))) if core_ink.size else 0.0
            ink_thresh = max(21.0, min(32.0, bg_ink * 0.12), noise_sig + 15.0)
            ink_ratio = float((core_ink > ink_thresh).sum()) / max(core_ink.size, 1)
            core_max = float(core_ink.max()) if core_ink.size else 0.0

            dot_region = diff_ink[int(ch * 0.35) : -5, 3:-3] if ch > 14 and cw > 8 else diff_ink
            dot_cnt = int((dot_region > max(ink_thresh * 1.15, 28.0)).sum())
            dot_max = float(dot_region.max()) if dot_region.size else 0.0
            has_dot = allow_dot and (dot_cnt >= 4) and (dot_max >= max(45.0, bg_ink * 0.20))

            if (ink_ratio <= 0.012 or core_max < max(24.0, noise_sig + 18.0)) and not has_dot:
                cells.append(None)
                continue

            g_pixels = core_g[core_g > max(28.0, bg_g * 0.15)]
            peak_g = float(np.percentile(g_pixels, 90)) if g_pixels.size > 0 else 0.0

            # Для контрастных чернил используем стандартный профиль полутонов (как при обучении/настройке),
            # для слабых/тонких/синих штрихов усиливаем контраст по сине-чувствительной карте.
            if peak_g >= max(50.0, bg_g * 0.42):
                old_thr = max(40.0, bg_g * 0.21)
                norm = np.clip(255.0 - diff_g * (255.0 / max(bg_g * 0.65, 65.0)), 0, 255).astype(np.uint8)
                norm[diff_g < old_thr * 0.65] = 255
            else:
                ink_pixels = core_ink[core_ink > ink_thresh * 0.7]
                peak_ink = float(np.percentile(ink_pixels, 90)) if ink_pixels.size > 0 else 55.0
                denom = max(ink_thresh * 1.5, peak_ink, 42.0)
                clean_ink = diff_ink.copy()
                clean_ink[clean_ink < ink_thresh * 0.85] = 0.0
                if not allow_dot and ch > 10 and cw > 8:
                    for r in (ch - 2, ch - 1):
                        rm = clean_ink[r, :] > 0
                        if float(rm.mean()) >= 0.35 and int((rm & (clean_ink[r - 2, :] > 0)).sum()) <= 2:
                            clean_ink[r, :] = 0.0
                    for c, nc in ((0, 2), (cw - 1, cw - 3)):
                        cm = clean_ink[:, c] > 0
                        if float(cm.mean()) >= 0.35 and int((cm & (clean_ink[:, nc] > 0)).sum()) <= 2:
                            clean_ink[:, c] = 0.0
                norm = np.clip(255.0 - clean_ink * (225.0 / denom), 0, 255).astype(np.uint8)

            cells.append(cv2.cvtColor(norm, cv2.COLOR_GRAY2BGR))
        return cells

    @classmethod
    def _extract_hw_cells(cls, strip_bgr, boxes, cells_p2, allow_dot=False):
        cells_p3 = cls._extract_clean_cells(strip_bgr, boxes, pad=3, allow_dot=allow_dot)
        merged = []
        for c2, c3 in zip(cells_p2, cells_p3):
            if c3 is not None:
                merged.append(c3)
            elif c2 is not None:
                merged.append(c2[1:-1, 1:-1] if c2.shape[0] > 12 and c2.shape[1] > 10 else c2)
            else:
                merged.append(None)
        return merged

    @staticmethod
    def _pack_cells(cells, spacer_w=6):
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

    def _read_cyrillic_field(self, aligned, y_center, x1, x2, expected_count=24, page_grid=None):
        H, W = aligned.shape[:2]
        strip = aligned[max(0, y_center - 36) : min(H, y_center + 36), max(0, x1) : min(W, x2)]
        if strip.size == 0:
            return "", 0.0

        raw_boxes = self._find_boxes_in_row(strip)
        if not raw_boxes and page_grid is None:
            return self.classifier.predict_field_strip(strip)

        boxes = self._fit_uniform_grid(
            raw_boxes, max(0, x1), expected_count, strip.shape, page_grid=page_grid
        )
        if not boxes:
            return self.classifier.predict_field_strip(strip)

        cells = self._extract_clean_cells(strip, boxes, pad=2, allow_dot=False)
        packed = self._pack_cells(cells, spacer_w=6)
        if packed is None:
            return "", 0.0
        med_txt, med_conf = self.classifier.predict_packed_cells(packed)

        if self.classifier.char_sess is not None:
            cells_hw = self._extract_hw_cells(strip, boxes, cells, allow_dot=False)
            hw_txt, hw_probs, hw_conf = self.classifier.predict_cells_char_onnx(
                cells_hw, alphabet_mode="cyrillic"
            )
            fused = self.classifier.fuse_cyrillic_with_handwritten(
                med_txt, hw_txt, hw_probs, hw_conf=hw_conf
            )
            if fused:
                return fused, max(med_conf, hw_conf)

        return med_txt, med_conf

    def _read_digit_field(
        self,
        aligned,
        y_center,
        x1,
        x2,
        min_boxes=1,
        expected_count=None,
        is_date=False,
        page_grid=None,
        x_offset_from_grid=0.0,
    ):
        H, W = aligned.shape[:2]
        strip = aligned[max(0, y_center - 36) : min(H, y_center + 36), max(0, x1) : min(W, x2)]
        if strip.size == 0:
            return "", 0.0

        raw_boxes = self._find_boxes_in_row(strip)
        if is_date and (len(raw_boxes) >= min_boxes or page_grid is not None):
            boxes = self._fit_date_grid(raw_boxes, max(0, x1), strip.shape, page_grid=page_grid)
        elif expected_count is not None and (len(raw_boxes) >= min_boxes or page_grid is not None):
            boxes = self._fit_uniform_grid(
                raw_boxes,
                max(0, x1),
                expected_count,
                strip.shape,
                page_grid=page_grid,
                x_offset_from_grid=x_offset_from_grid,
            )
        else:
            boxes = raw_boxes

        if len(boxes) >= min_boxes:
            cells_p2 = self._extract_clean_cells(strip, boxes, pad=2, allow_dot=False)
            if not any(c is not None for c in cells_p2):
                return "", 0.0
            if self.classifier.char_sess is not None:
                cells_hw = self._extract_hw_cells(strip, boxes, cells_p2, allow_dot=False)
                hw_txt, _, hw_conf = self.classifier.predict_cells_char_onnx(
                    cells_hw, alphabet_mode="digits"
                )
                if hw_txt:
                    return hw_txt, hw_conf

            packed = self._pack_cells(cells_p2, spacer_w=6)
            if packed is None:
                return "", 0.0
            return self.classifier.predict_packed_cells(packed)

        return self.classifier.predict_field_strip(strip)

    def _read_email_field(self, aligned, y_center, x1, x2, expected_count=24, page_grid=None):
        H, W = aligned.shape[:2]
        strip = aligned[max(0, y_center - 36) : min(H, y_center + 36), max(0, x1) : min(W, x2)]
        if strip.size == 0:
            return "", "", "", None, 0.0, 0.0

        raw_boxes = self._find_boxes_in_row(strip)
        if not raw_boxes and page_grid is None:
            txt, conf = self.classifier.predict_field_strip(strip)
            return txt, "", "", None, 0.0, conf

        boxes = self._fit_uniform_grid(
            raw_boxes, max(0, x1), expected_count, strip.shape, page_grid=page_grid
        )
        if boxes:
            cells = self._extract_clean_cells(strip, boxes, pad=2, allow_dot=True)
            packed = self._pack_cells(cells, spacer_w=3)
            if packed is None:
                return "", "", "", None, 0.0, 0.0
            txt, conf = self.classifier.predict_packed_cells(packed)
            lat_txt, lat_conf = self.classifier.predict_packed_cells(packed, use_latin=True)
            hw_txt, hw_probs, hw_conf = "", None, 0.0
            if self.classifier.char_sess is not None:
                cells_hw = self._extract_hw_cells(strip, boxes, cells, allow_dot=True)
                hw_txt, hw_probs, hw_conf = self.classifier.predict_cells_char_onnx(
                    cells_hw, alphabet_mode="email"
                )
            return txt, lat_txt, hw_txt, hw_probs, hw_conf, max(conf, lat_conf, hw_conf)

        txt, conf = self.classifier.predict_field_strip(strip)
        return txt, "", "", None, 0.0, conf

    def _check_form_keywords(self, warped):
        labels_res, _ = self.classifier.engine(warped[110:630, 40:260])
        labels_text = " ".join(
            [str(r[1]).upper() for r in (labels_res or []) if isinstance(r, (list, tuple)) and len(r) >= 2]
        )
        header_res, _ = self.classifier.engine(warped[30:180, 80:1100])
        header_text = " ".join(
            [str(r[1]).upper() for r in (header_res or []) if isinstance(r, (list, tuple)) and len(r) >= 2]
        )
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
        page_grid = self._estimate_page_grid(aligned, rows, align_type)

        selected_distance = self._extract_distance(aligned, rows["dist"], align_type)
        selected_gender = self._extract_gender(aligned, rows["date"], align_type)

        raw_surname, s_conf = self._read_cyrillic_field(
            aligned, rows["surname"], 195, 1060, expected_count=24, page_grid=page_grid
        )
        surname = self.classifier.decode_surname(raw_surname)

        raw_name, n_conf = self._read_cyrillic_field(
            aligned, rows["name"], 195, 1060, expected_count=24, page_grid=page_grid
        )
        name = self.classifier.decode_name(raw_name)

        raw_patronymic, p_conf = self._read_cyrillic_field(
            aligned, rows["patronymic"], 195, 1060, expected_count=24, page_grid=page_grid
        )
        patronymic = self.classifier.decode_patronymic(raw_patronymic) if raw_patronymic else ""

        raw_date, d_conf = self._read_digit_field(
            aligned, rows["date"], 195, 575, min_boxes=3, expected_count=8, is_date=True, page_grid=page_grid
        )
        birth_formatted, date_valid, calculated_age = self.validator.parse_and_validate_date(
            raw_date, reference_year=event_year
        )

        raw_phone, ph_conf = self._read_digit_field(
            aligned, rows["phone"], 195, 650, min_boxes=4, expected_count=10, page_grid=page_grid
        )
        phone_formatted = self.classifier.decode_phone(raw_phone)
        _, phone_valid = self.validator.validate_phone(raw_phone)

        raw_email, raw_email_lat, raw_email_hw, hw_em_probs, hw_em_conf, em_conf = self._read_email_field(
            aligned, rows["email"], 195, 1080, expected_count=24, page_grid=page_grid
        )
        email_formatted = self.classifier.decode_email(
            raw_email, raw_email_lat, raw_email_hw, hw_em_conf, hw_em_probs
        )

        raw_city, c_conf = self._read_cyrillic_field(
            aligned, rows["city"], 195, 950, expected_count=20, page_grid=page_grid
        )
        city_formatted = self.classifier.decode_city(raw_city)

        raw_prev, _ = self._read_digit_field(
            aligned,
            rows["prev"],
            210,
            370,
            min_boxes=1,
            expected_count=2,
            page_grid=page_grid,
            x_offset_from_grid=20.0,
        )
        clean_prev = self.classifier.normalize_digits(raw_prev)
        prev_nums = re.findall(r"\d+", clean_prev)
        prev_walks = str(int(prev_nums[0])) if prev_nums else ""

        raw_card, _ = self._read_digit_field(
            aligned, rows["card"], 195, 480, min_boxes=2, expected_count=6
        )
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
