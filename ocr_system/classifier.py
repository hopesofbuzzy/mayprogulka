import os
import re
import unicodedata
import cv2
import numpy as np
import onnxruntime as ort
from rapidocr_onnxruntime import RapidOCR

COMMON_RUSSIAN_CITIES = [
    "ЕКАТЕРИНБУРГ", "ИЖЕВСК", "НИЖНИЙ ТАГИЛ", "КАМЕНСК-УРАЛЬСКИЙ", "ПЕРВОУРАЛЬСК",
    "БЕРЕЗОВСКИЙ", "ВЕРХНЯЯ ПЫШМА", "АСБЕСТ", "СЫСЕРТЬ", "РЕВДА", "НОВОУРАЛЬСК",
    "ТЮМЕНЬ", "ЧЕЛЯБИНСК", "МОСКВА", "САНКТ-ПЕТЕРБУРГ", "КУРГАН", "ПЕРМЬ", "ПОЛЕВСКОЙ",
    "ЗАРЕЧНЫЙ", "СРЕДНЕУРАЛЬСК", "КРАСНОУФИМСК", "АРАМИЛЬ", "УФА", "КАЗАНЬ",
]

COMMON_RUSSIAN_NAMES = [
    "АЛЕКСЕЙ", "АЛЕКСАНДР", "ИВАН", "ДМИТРИЙ", "МАКСИМ", "СЕРГЕЙ", "АНДРЕЙ",
    "АРТЕМ", "АРТЁМ", "ИЛЬЯ", "МИХАИЛ", "НИКИТА", "ЕГОР", "МАТВЕЙ", "ТИМОФЕЙ", "РОМАН",
    "ВЛАДИМИР", "ЯРОСЛАВ", "ФЕДОР", "ФЁДОР", "ГЛЕБ", "КОНСТАНТИН", "ГЕОРГИЙ", "ГРИГОРИЙ",
    "АННА", "ЕЛЕНА", "ОЛЬГА", "МАРИЯ", "ЕКАТЕРИНА", "НАТАЛЬЯ", "ИРИНА", "СВЕТЛАНА",
    "ЮЛИЯ", "ДАРЬЯ", "ПАВЕЛ", "ОЛЕГ", "ВИКТОР", "ТАТЬЯНА", "ВАСИЛИЙ", "ПЕТР", "ПЁТР",
    "НИКОЛАЙ", "МАРИНА", "КИРИЛЛ", "АНТОН", "ДЕНИС", "ВАДИМ", "ЕВГЕНИЙ", "ВЯЧЕСЛАВ",
    "СТАНИСЛАВ", "ЮРИЙ", "ИГОРЬ", "БОРИС", "РУСЛАН", "ТИМУР", "ДАНИИЛ", "ВАЛЕРИЙ",
    "ГЕННАДИЙ", "ЭДУАРД", "АРСЕНИЙ", "МАРК", "ЛЕВ", "АЛЕКСАНДРА", "АНАСТАСИЯ", "ВИКТОРИЯ",
    "ПОЛИНА", "КСЕНИЯ", "СОФЬЯ", "ГАЛИНА", "ЛАРИСА", "ЛЮДМИЛА", "НАДЕЖДА", "ТАМАРА",
    "ВАЛЕНТИНА", "ВЕРА", "ЛЮБОВЬ", "ЛИДИЯ", "ЕВГЕНИЯ", "АЛИНА", "ДИАНА", "КРИСТИНА",
    "ВАЛЕРИЯ", "АЛЕНА", "АЛЁНА", "ТАИСИЯ",
]

COMMON_RUSSIAN_PATRONYMICS = [
    "АЛЕКСАНДРОВИЧ", "АЛЕКСАНДРОВНА", "АЛЕКСЕЕВИЧ", "АЛЕКСЕЕВНА",
    "АНАТОЛЬЕВИЧ", "АНАТОЛЬЕВНА", "АНДРЕЕВИЧ", "АНДРЕЕВНА",
    "АРТЕМОВИЧ", "АРТЕМОВНА", "БОРИСОВИЧ", "БОРИСОВНА",
    "ВАЛЕРЬЕВИЧ", "ВАЛЕРЬЕВНА", "ВАСИЛЬЕВИЧ", "ВАСИЛЬЕВНА",
    "ВИКТОРОВИЧ", "ВИКТОРОВНА", "ВЛАДИМИРОВИЧ", "ВЛАДИМИРОВНА",
    "ВЯЧЕСЛАВОВИЧ", "ВЯЧЕСЛАВОВНА", "ГЕННАДЬЕВИЧ", "ГЕННАДЬЕВНА",
    "ГЕОРГИЕВИЧ", "ГЕОРГИЕВНА", "ГРИГОРЬЕВИЧ", "ГРИГОРЬЕВНА",
    "ДЕНИСОВИЧ", "ДЕНИСОВНА", "ДМИТРИЕВИЧ", "ДМИТРИЕВНА",
    "ЕВГЕНЬЕВИЧ", "ЕВГЕНЬЕВНА", "ЕГОРОВИЧ", "ЕГОРОВНА",
    "ИВАНОВИЧ", "ИВАНОВНА", "ИГОРЕВИЧ", "ИГОРЕВНА",
    "ИЛЬИЧ", "ИЛЬИНИЧНА", "КОНСТАНТИНОВИЧ", "КОНСТАНТИНОВНА",
    "МАКСИМОВИЧ", "МАКСИМОВНА", "МИХАЙЛОВИЧ", "МИХАЙЛОВНА",
    "НИКИТИЧ", "НИКИТИЧНА", "НИКОЛАЕВИЧ", "НИКОЛАЕВНА",
    "ОЛЕГОВИЧ", "ОЛЕГОВНА", "ПАВЛОВИЧ", "ПАВЛОВНА",
    "ПЕТРОВИЧ", "ПЕТРОВНА", "РОМАНОВИЧ", "РОМАНОВНА",
    "СЕРГЕЕВИЧ", "СЕРГЕЕВНА", "СТАНИСЛАВОВИЧ", "СТАНИСЛАВОВНА",
    "ТИМУРОВИЧ", "ТИМУРОВНА", "ФЕДОРОВИЧ", "ФЕДОРОВНА",
    "ЮРЬЕВИЧ", "ЮРЬЕВНА", "ЯРОСЛАВОВИЧ", "ЯРОСЛАВОВНА",
]

_LAT_TO_CYR = str.maketrans({
    "A": "А", "B": "В", "C": "С", "E": "Е", "H": "Н",
    "K": "К", "M": "М", "O": "О", "P": "Р", "T": "Т", "X": "Х",
})

_CYR_TO_LAT = str.maketrans({
    "а": "a", "в": "b", "е": "e", "к": "k", "м": "m",
    "н": "h", "о": "o", "р": "p", "с": "c", "т": "t",
    "у": "y", "х": "x", "г": "r", "и": "i",
})

_CHAR_TO_DIGIT = str.maketrans({
    "О": "0", "о": "0", "O": "0", "o": "0", "D": "0",
    "I": "1", "l": "1", "|": "1",
    "З": "3", "з": "3",
    "Ч": "4", "ч": "4",
    "S": "5", "s": "5",
    "Б": "6", "б": "6",
    "В": "8",
    "g": "9",
})

_KNOWN_MAIL_DOMAINS = [
    ("gmail.com", ["gmailcom"]),
    ("yandex.ru", ["yandexru", "yandexro"]),
    ("inbox.ru", ["inboxru", "inboxro"]),
    ("list.ru", ["listru", "listro"]),
    ("rambler.ru", ["ramblerru", "ramblerro"]),
    ("urfu.ru", ["urfuru", "urfuro"]),
    ("bk.ru", ["bkru", "bkro"]),
    ("mail.ru", ["mailru", "mailro"]),
]


def levenshtein_dist(s1, s2):
    if len(s1) > len(s2):
        s1, s2 = s2, s1
    distances = range(len(s1) + 1)
    for i2, c2 in enumerate(s2):
        distances_ = [i2 + 1]
        for i1, c1 in enumerate(s1):
            if c1 == c2:
                distances_.append(distances[i1])
            else:
                distances_.append(
                    1 + min((distances[i1], distances[i1 + 1], distances_[-1]))
                )
        distances = distances_
    return distances[-1]


def _fuzzy_match_from_list(cleaned, candidates):
    if not cleaned:
        return ""
    if cleaned in candidates:
        return cleaned
    compact = cleaned.replace(" ", "").replace("-", "")
    scored = []
    for cand in candidates:
        cand_compact = cand.replace(" ", "").replace("-", "")
        if abs(len(compact) - len(cand_compact)) > 1:
            continue
        d = levenshtein_dist(compact, cand_compact)
        max_allowed = 1 if len(cand_compact) <= 7 else 2
        if d <= max_allowed:
            scored.append((d, cand))
    if not scored:
        return cleaned
    scored.sort(key=lambda x: x[0])
    if len(scored) == 1 or scored[0][0] < scored[1][0]:
        return scored[0][1]
    return cleaned


class DeepLearningOCRClassifier:
    """
    Нейросетевой OCR-классификатор:
    - PP-OCRv6 Medium Cyrillic (строки / контекст)
    - Дообученная модель HandwrittenBoxNet ONNX (CoMNIST + MNIST + шрифты) для поклеточных рукописных цифр и букв
    - Базовая латинская модель RapidOCR для e-mail и '@'
    """

    def __init__(
        self,
        model_path="ocr_system/models/pp_v6_medium/inference.onnx",
        dict_path="ocr_system/models/pp_v6_medium/dict.txt",
        hw_onnx_path="ocr_system/models/handwritten_char.onnx",
        hw_dict_path="ocr_system/models/handwritten_dict.txt",
    ):
        # Отключение det/cls через конструктор совместимо как с rapidocr-onnxruntime 1.2.3, так и с 1.4.x
        if os.path.exists(model_path) and os.path.exists(dict_path):
            self.engine = RapidOCR(
                rec_model_path=model_path, rec_keys_path=dict_path
            )
            self.rec_engine = RapidOCR(
                use_det=False,
                use_cls=False,
                rec_model_path=model_path,
                rec_keys_path=dict_path,
            )
            self.latin_engine = RapidOCR(use_det=False, use_cls=False)
        else:
            self.engine = RapidOCR()
            self.rec_engine = RapidOCR(use_det=False, use_cls=False)
            self.latin_engine = self.rec_engine

        self.char_sess = None
        self.char_classes = []
        self.char_to_idx = {}
        self.char_masks = {}

        if os.path.exists(hw_onnx_path) and os.path.exists(hw_dict_path):
            with open(hw_dict_path, "r", encoding="utf-8") as f:
                self.char_classes = [l.rstrip("\r\n") for l in f if l.rstrip("\r\n")]
            self.char_to_idx = {c: i for i, c in enumerate(self.char_classes)}
            self.char_sess = ort.InferenceSession(
                hw_onnx_path, providers=["CPUExecutionProvider"]
            )
            self.char_input_name = self.char_sess.get_inputs()[0].name
            self.char_masks = {
                "cyrillic": np.array(
                    [c in "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ-" for c in self.char_classes],
                    dtype=bool,
                ),
                "digits": np.array(
                    [c in "0123456789" for c in self.char_classes],
                    dtype=bool,
                ),
                "email": np.array(
                    [c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-.@_" for c in self.char_classes],
                    dtype=bool,
                ),
            }

    @staticmethod
    def _parse_ocr_result(res):
        """Унифицированный разбор ответа RapidOCR ([box, text, score] или (text, score), со строковым или float score)."""
        if not res:
            return "", 0.0

        items = []
        for entry in res:
            if not isinstance(entry, (list, tuple)) or len(entry) < 2:
                continue
            if len(entry) == 2 and not isinstance(entry[0], (list, tuple)):
                txt = str(entry[0]).strip()
                try:
                    conf = float(entry[1])
                except (TypeError, ValueError):
                    conf = 0.0
                items.append((0.0, txt, conf))
            elif len(entry) >= 3:
                box = entry[0]
                txt = str(entry[1]).strip()
                try:
                    conf = float(entry[2])
                except (TypeError, ValueError):
                    conf = 0.0
                try:
                    x_left = float(min(pt[0] for pt in box))
                except Exception:
                    x_left = 0.0
                items.append((x_left, txt, conf))

        if not items:
            return "", 0.0

        items.sort(key=lambda t: t[0])
        non_empty = [t for t in items if t[1]]
        if not non_empty:
            return "", 0.0
        full_text = "".join(t[1] for t in non_empty)
        avg_conf = float(np.mean([t[2] for t in non_empty]))
        return full_text, avg_conf

    @staticmethod
    def _cell_to_48x48(cell_bgr):
        g = cv2.cvtColor(cell_bgr, cv2.COLOR_BGR2GRAY) if cell_bgr.ndim == 3 else cell_bgr
        h, w = g.shape[:2]
        scale = 42.0 / max(h, w, 1)
        nw = max(1, int(round(w * scale)))
        nh = max(1, int(round(h * scale)))
        resized = cv2.resize(
            g, (nw, nh), interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR
        )
        canvas = np.full((48, 48), 255, dtype=np.uint8)
        x0 = (48 - nw) // 2
        y0 = (48 - nh) // 2
        canvas[y0 : y0 + nh, x0 : x0 + nw] = resized
        return ((255.0 - canvas.astype(np.float32)) / 255.0)[None, None, :, :]

    def predict_cells_char_onnx(self, cells, alphabet_mode="cyrillic"):
        """Поклеточное распознавание обученной ONNX-моделью с маскированием под алфавит поля."""
        valid = [c for c in cells if c is not None]
        if not valid or self.char_sess is None:
            return "", None, 0.0

        batch = np.concatenate([self._cell_to_48x48(c) for c in valid], axis=0)
        logits = self.char_sess.run(None, {self.char_input_name: batch})[0]
        mask = self.char_masks.get(alphabet_mode)
        if mask is not None:
            logits[:, ~mask] = -1e9
        exps = np.exp(logits - logits.max(axis=1, keepdims=True))
        probs = exps / exps.sum(axis=1, keepdims=True)
        if alphabet_mode == "email" and "." in self.char_to_idx:
            dot_i = self.char_to_idx["."]
            for idx_c, cell in enumerate(valid):
                g = cv2.cvtColor(cell, cv2.COLOR_BGR2GRAY) if cell.ndim == 3 else cell
                ch, cw = g.shape[:2]
                ys, xs = np.where(g < 180)
                if len(xs) > 0:
                    ih = (ys.max() - ys.min() + 1) / float(max(ch, 1))
                    iw = (xs.max() - xs.min() + 1) / float(max(cw, 1))
                    yc = float(ys.mean()) / float(max(ch, 1))
                    if ih <= 0.45 and iw <= 0.48 and yc >= 0.68 and 0.70 <= (iw / max(ih, 0.01)) <= 1.40:
                        probs[idx_c] = 0.0
                        probs[idx_c, dot_i] = 0.95
        text = "".join(self.char_classes[int(np.argmax(row))] for row in probs)
        avg_conf = float(np.mean(probs.max(axis=1)))
        return text, probs, avg_conf

    def fuse_cyrillic_with_handwritten(self, med_raw, hw_str, hw_probs, hw_conf=0.0):
        """
        Объединяет строковый выход PP-OCRv6 (контекст слова) с поклеточной
        рукописной ONNX-моделью. Если PP-OCRv6 потерял/склеил ячейки (разная длина),
        а поклеточная модель уверена — опирается на поклеточное распознавание.
        """
        med_clean = self._clean_cyrillic(med_raw).replace(" ", "")
        if not hw_str or hw_probs is None:
            return med_clean
        if not med_clean:
            return hw_str
        if len(med_clean) != len(hw_str):
            if len(hw_str) > len(med_clean) and hw_conf >= 0.68:
                return hw_str
            return med_clean

        out = []
        for i, (m_ch, h_ch) in enumerate(zip(med_clean, hw_str)):
            if m_ch == h_ch:
                out.append(m_ch)
                continue
            # Не подменяем Е/И на Ё/Й из-за возможных остатков верхней рамки ячейки
            if (m_ch == "Е" and h_ch == "Ё") or (m_ch == "И" and h_ch == "Й"):
                out.append(m_ch)
                continue
            row = hw_probs[i]
            h_prob = float(row.max())
            m_idx = self.char_to_idx.get(m_ch)
            m_prob = float(row[m_idx]) if m_idx is not None else 0.0
            if h_prob >= 0.65 and h_prob >= 2.0 * max(m_prob, 1e-4):
                out.append(h_ch)
            else:
                out.append(m_ch)
        return "".join(out)

    def _clean_cyrillic(self, raw_str):
        if not raw_str:
            return ""
        upper = raw_str.upper().translate(_LAT_TO_CYR)
        return re.sub(r"[^А-ЯЁ\- ]", "", upper).strip()

    def decode_surname(self, raw_str):
        return self._clean_cyrillic(raw_str).replace(" ", "")

    def decode_name(self, raw_str):
        cleaned = self._clean_cyrillic(raw_str).replace(" ", "")
        if not cleaned:
            return ""
        if len(cleaned) <= 4:
            return cleaned
        return _fuzzy_match_from_list(cleaned, COMMON_RUSSIAN_NAMES)

    def decode_patronymic(self, raw_str):
        cleaned = self._clean_cyrillic(raw_str).replace(" ", "")
        if not cleaned:
            return ""
        if len(cleaned) <= 4:
            return cleaned
        return _fuzzy_match_from_list(cleaned, COMMON_RUSSIAN_PATRONYMICS)

    def decode_city(self, raw_str):
        cleaned = self._clean_cyrillic(raw_str)
        if not cleaned:
            return ""
        return _fuzzy_match_from_list(cleaned, COMMON_RUSSIAN_CITIES)

    def _normalize_email_str(self, raw_str, translate_cyr=True):
        if not raw_str:
            return ""
        s = unicodedata.normalize("NFKC", raw_str).strip().lower()
        if translate_cyr:
            s = s.translate(_CYR_TO_LAT)
        s = s.replace(" ", "")
        s = re.sub(r"[\(\[]a[\)\]]", "@", s)
        s = re.sub(r"[^a-z0-9@._\-]", "", s)
        return s.strip(".")

    def _fix_email_domain(self, dom):
        if not dom:
            return ""
        for canon, aliases in _KNOWN_MAIL_DOMAINS:
            if dom == canon or dom in aliases:
                return canon
        dom_compact = dom.replace(".", "")
        best = None
        for canon, _ in _KNOWN_MAIL_DOMAINS:
            canon_compact = canon.replace(".", "")
            if len(canon_compact) >= 6:
                d = levenshtein_dist(dom_compact, canon_compact)
                if d <= 2 and (best is None or d < best[0]):
                    best = (d, canon)
        if best is not None:
            return best[1]
        return dom

    def decode_email(self, raw_str, raw_lat=None, raw_hw=None, hw_conf=0.0, hw_probs=None):
        med_s = self._normalize_email_str(raw_str, translate_cyr=True)
        lat_s = self._normalize_email_str(raw_lat, translate_cyr=False) if raw_lat else ""
        hw_s = self._normalize_email_str(raw_hw, translate_cyr=False) if raw_hw else ""

        if not med_s and not lat_s and not hw_s:
            return ""

        # Вспомогательная проверка: если поклеточная ONNX-модель уверенно нашла точку '.' с конца (например в 3-й с конца ячейке перед 'ru'),
        # а строковые модели потеряли эту точку, восстанавливаем её по позиции с конца.
        def _restore_trailing_dot_from_hw(candidate):
            if not candidate or "." in candidate.split("@")[-1] or hw_probs is None:
                return candidate
            dot_idx = self.char_to_idx.get(".")
            if dot_idx is None:
                return candidate
            n_cells = len(hw_probs)
            for offset in (3, 4):  # .ru (3-й с конца), .com (4-й с конца)
                pos = n_cells - offset
                if 1 <= pos < n_cells and float(hw_probs[pos][dot_idx]) >= 0.45:
                    tld_len = offset - 1
                    if len(candidate) > tld_len + 1:
                        return candidate[:-tld_len] + "." + candidate[-tld_len:]
            return candidate

        # 0. Если поклеточная обученная ONNX-модель уверенно распознала e-mail с '@' (напр. OLGA_95@BK.RU, USER123@YANDEX.RU)
        if hw_s and "@" in hw_s and hw_conf >= 0.80:
            h_local, h_dom = hw_s.split("@", 1)
            if "0" in h_local:
                if med_s and "@" in med_s:
                    m_local = med_s.split("@", 1)[0]
                    if len(m_local) == len(h_local) and all(mc == hc or (mc == "o" and hc == "0") for mc, hc in zip(m_local, h_local)):
                        h_local = m_local
                h_local = re.sub(r"(?<=[a-z])0(?=[a-z])", "o", h_local)
            # Если в домене буква O прочиталась как '0' (напр. MAYPR0GULKA.RU), проверяем контекст кириллической модели / буквенных соседей
            if "0" in h_dom:
                if med_s and "@" in med_s:
                    m_dom = med_s.split("@", 1)[1].replace(" ", "")
                    if "o" in m_dom and len(m_dom.replace(".", "")) == len(h_dom.replace(".", "")):
                        h_dom = h_dom.replace("0", "o")
                h_dom = re.sub(r"(?<=[a-z])0(?=[a-z])", "o", h_dom)
                h_dom = re.sub(r"(?<=[a-z])0(?=\.)", "o", h_dom)
            h_dom = self._fix_email_domain(h_dom)
            if h_local and h_dom:
                return f"{h_local}@{h_dom}"

        # 1. Если латинская модель распознала '@', используем её разбиение local@domain
        if "@" in lat_s:
            lat_local, lat_dom = lat_s.split("@", 1)
            lat_dom = _restore_trailing_dot_from_hw(lat_dom)
            lat_dom = self._fix_email_domain(lat_dom)
            dom_compact = lat_dom.replace(".", "")
            med_clean = med_s.replace("@", "")
            for cand_dom in [lat_dom, dom_compact]:
                if med_clean.endswith(cand_dom) and len(med_clean) > len(cand_dom):
                    med_local = med_clean[: -len(cand_dom)].rstrip("@._-")
                    if (
                        len(med_local) == len(lat_local) + 1
                        and med_local.startswith(lat_local)
                        and med_local[-1] in ("o", "d", "e", "g", "c", "0")
                    ):
                        med_local = lat_local
                    if med_local and levenshtein_dist(med_local, lat_local) <= 2 and len(med_local) >= len(lat_local):
                        return f"{med_local}@{lat_dom}"
            if lat_local and lat_dom:
                return f"{lat_local}@{lat_dom}"

        # 2. Если '@' уже есть в основном выходе
        if "@" in med_s:
            local, dom = med_s.split("@", 1)
            dom = _restore_trailing_dot_from_hw(dom)
            return f"{local}@{self._fix_email_domain(dom)}"

        # 3. Если одна из моделей (обычно lat) распознала известный домен, а другая расходится в 1 разделителе перед ним ('d' vs 'o')
        for primary, secondary in [(lat_s, med_s), (med_s, lat_s)]:
            if not primary:
                continue
            for canon, aliases in _KNOWN_MAIL_DOMAINS:
                for target in [canon] + aliases:
                    if primary.endswith(target) and len(primary) > len(target):
                        p_prefix = primary[: -len(target)]
                        if secondary and len(secondary) >= len(p_prefix) and len(p_prefix) >= 2:
                            s_prefix = secondary[: len(p_prefix)]
                            if p_prefix[:-1] == s_prefix[:-1] and p_prefix[-1] != s_prefix[-1]:
                                return f"{p_prefix[:-1]}@{canon}"
                        return f"{p_prefix.rstrip('._-')}@{canon}"

        return _restore_trailing_dot_from_hw(lat_s or med_s or hw_s)

    def normalize_digits(self, raw_str):
        if not raw_str:
            return ""
        translated = raw_str.translate(_CHAR_TO_DIGIT)
        return re.sub(r"\D", "", translated)

    def decode_phone(self, raw_str):
        digits = self.normalize_digits(raw_str)
        if not digits:
            return ""
        if len(digits) == 11 and digits[0] in ("7", "8"):
            d = digits[1:]
            return f"+7 ({d[:3]}) {d[3:6]}-{d[6:8]}-{d[8:10]}"
        if len(digits) == 10:
            return f"+7 ({digits[:3]}) {digits[3:6]}-{digits[6:8]}-{digits[8:10]}"
        if len(digits) > 10:
            d = digits[-10:]
            return f"+7 ({d[:3]}) {d[3:6]}-{d[6:8]}-{d[8:10]}"
        return digits

    def predict_packed_cells(self, packed_bgr, use_latin=False):
        if packed_bgr is None or packed_bgr.size == 0:
            return "", 0.0
        eng = self.latin_engine if use_latin else self.rec_engine
        res, _ = eng(packed_bgr)
        return self._parse_ocr_result(res)

    def predict_field_strip(self, strip_bgr):
        if strip_bgr is None or strip_bgr.size == 0:
            return "", 0.0
        res, _ = self.engine(strip_bgr)
        return self._parse_ocr_result(res)
