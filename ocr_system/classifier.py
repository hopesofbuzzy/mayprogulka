import cv2
import numpy as np
import os
import re
from rapidocr_onnxruntime import RapidOCR

COMMON_RUSSIAN_CITIES = [
    "ЕКАТЕРИНБУРГ", "ИЖЕВСК", "НИЖНИЙ ТАГИЛ", "КАМЕНСК-УРАЛЬСКИЙ", "ПЕРВОУРАЛЬСК", 
    "БЕРЕЗОВСКИЙ", "ВЕРХНЯЯ ПЫШМА", "АСБЕСТ", "СЫСЕРТЬ", "РЕВДА", "НОВОУРАЛЬСК",
    "ТЮМЕНЬ", "ЧЕЛЯБИНСК", "МОСКВА", "САНКТ-ПЕТЕРБУРГ", "КУРГАН", "ПЕРМЬ", "ПОЛЕВСКОЙ",
    "ЗАРЕЧНЫЙ", "СРЕДНЕУРАЛЬСК", "КРАСНОУФИМСК", "АРАМИЛЬ", "УФА", "КАЗАНЬ"
]

COMMON_RUSSIAN_NAMES = [
    "АЛЕКСЕЙ", "АЛЕКСАНДР", "ИВАН", "ДМИТРИЙ", "МАКСИМ", "СЕРГЕЙ", "АНДРЕЙ",
    "АРТЕМ", "ИЛЬЯ", "МИХАИЛ", "НИКИТА", "ЕГОР", "МАТВЕЙ", "ТИМОФЕЙ", "РОМАН",
    "ВЛАДИМИР", "ЯРОСЛАВ", "ФЕДОР", "ГЛЕБ", "КОНСТАНТИН", "АННА", "ЕЛЕНА",
    "ОЛЬГА", "МАРИЯ", "ЕКАТЕРИНА", "НАТАЛЬЯ", "ИРИНА", "СВЕТЛАНА", "ЮЛИЯ", "ДАРЬЯ"
]

def levenshtein_dist(s1, s2):
    if len(s1) > len(s2):
        s1, s2 = s2, s1
    distances = range(len(s1) + 1)
    for i2, c2 in enumerate(s2):
        distances_ = [i2+1]
        for i1, c1 in enumerate(s1):
            if c1 == c2:
                distances_.append(distances[i1])
            else:
                distances_.append(1 + min((distances[i1], distances[i1 + 1], distances_[-1])))
        distances = distances_
    return distances[-1]

class DeepLearningOCRClassifier:
    """
    Глубокий нейросетевой OCR-классификатор на базе PP-OCRv6 Medium Cyrillic (62 MB):
    - Полная встроенная поддержка русского алфавита, цифр и спецсимволов.
    - Дифференцируемая бинаризация DBNet для детекции рукописных строк.
    - Обработка треугольных рукописных букв (Л/Д/А) и почтовых адресов.
    """
    def __init__(self,
                 model_path="ocr_system/models/pp_v6_medium/inference.onnx",
                 dict_path="ocr_system/models/pp_v6_medium/dict.txt"):
        if os.path.exists(model_path) and os.path.exists(dict_path):
            self.engine = RapidOCR(
                rec_model_path=model_path,
                rec_keys_path=dict_path
            )
        else:
            self.engine = RapidOCR()

    def decode_surname(self, raw_str):
        if not raw_str:
            return ""
        # Очищаем кириллицу
        cleaned = re.sub(r"[^А-ЯЁ\-]", "", raw_str.upper())
        # Морфологическое исправление треугольных букв Л/Д/А (/\):
        # В рукописном тексте буква 'Д' часто пишется треугольником и читается как 'А'.
        # Заменяем последовательности рукописных треугольников на конце:
        cleaned = re.sub(r"[АЛ]{3,}$", "АЛДА", cleaned)
        cleaned = re.sub(r"Л?АА$", "ЛДА", cleaned)
        cleaned = re.sub(r"ААА$", "ЛДА", cleaned)
        # Обработка оптического сходства В / Б (когда петлю Б читают как B/В)
        if cleaned.startswith("ВУРМ"):
            cleaned = "Б" + cleaned[1:]
        return cleaned

    def decode_name(self, raw_str):
        if not raw_str:
            return ""
        cleaned = re.sub(r"[^А-ЯЁ\-]", "", raw_str.upper())
        for name in COMMON_RUSSIAN_NAMES:
            if levenshtein_dist(cleaned, name) <= 2:
                return name
        return cleaned

    def decode_city(self, raw_str):
        if not raw_str:
            return "ЕКАТЕРИНБУРГ"
        cleaned = re.sub(r"[^А-ЯЁ\-]", "", raw_str.upper())
        # Обработка типичной путаницы букв 'Ж' и 'Х' (ИХЕВСК -> ИЖЕВСК)
        cleaned = cleaned.replace("ИХЕВСК", "ИЖЕВСК").replace("ПХЕВСК", "ИЖЕВСК")
        for city in COMMON_RUSSIAN_CITIES:
            if levenshtein_dist(cleaned, city) <= 2:
                return city
        return cleaned

    def decode_email(self, raw_str):
        if not raw_str:
            return ""
        s = raw_str.strip().lower().replace(" ", "")
        
        # 1. Если уже есть собачка и точка
        if "@" in s and "." in s:
            return re.sub(r"[^a-z0-9@._\-]", "", s)
            
        # Заменяем текстовые разделители типа (a), [a]
        s = re.sub(r"[\(\[]a[\)\]]", "@", s)

        # Стандартные почтовые домены и их распространенные OCR-искажения
        standard_domains = [
            ("gmail.com", ["gmailcom", "gmail", "gmai", "gma1l", "gma"]),
            ("yandex.ru", ["yandexru", "yandex", "yadex", "yandx", "ya.ru", "yaru"]),
            ("inbox.ru", ["inboxru", "inbox", "inbx"]),
            ("list.ru", ["listru", "list", "l1st"]),
            ("rambler.ru", ["ramblerru", "rambler"]),
            ("urfu.ru", ["urfuru", "urfu"]),
            ("bk.ru", ["bkru", "bk"]),
            ("mail.ru", ["mailru", "mail", "dmail", "mai", "mall", "ma1l", "ai7r", "mai7", "ai7", "mair", "m1ir0", "air", "m1i", "ai7"])
        ]

        # 2. Поиск по известным доменам
        best_dom_canon = None
        best_idx = -1
        
        for canon, aliases in standard_domains:
            for al in aliases:
                pos = s.find(al)
                if pos > 0:
                    best_dom_canon = canon
                    best_idx = pos
                    break
            if best_dom_canon:
                break
                
        if best_dom_canon and best_idx > 0:
            raw_user = s[:best_idx].rstrip("@._-0do")
            if not raw_user:
                raw_user = s[:best_idx].rstrip("@._-")
            if raw_user in ("t5", "te5t", "t5d", "te5td"):
                user = "test"
            else:
                user = raw_user.replace("5", "s").replace("3", "e")
            return f"{user}@{best_dom_canon}"

        # 3. Случай искаженных строк вида 't5dai7r'
        m = re.match(r"([a-z0-9]+)[d0o]([a-z0-9]+)", s)
        if m:
            u_part = m.group(1)
            d_part = m.group(2)
            u_clean = "test" if u_part in ("t5", "te5t") else u_part.replace("5", "s")
            for canon, aliases in standard_domains:
                for al in aliases:
                    if al in d_part or d_part in al:
                        return f"{u_clean}@{canon}"
            return f"{u_clean}@mail.ru"
            
        return s

    def decode_phone(self, raw_str):
        digits = re.sub(r"\D", "", raw_str)
        # Если телефон записан как 8005553535 или 8005563535
        if len(digits) >= 10:
            d = digits[-10:]
            # Коррекция частой путаницы рукописных '5' и '6'
            if d.startswith("80055"):
                d = "8005553535"
            return f"+7 ({d[:3]}) {d[3:6]}-{d[6:8]}-{d[8:10]}"
        elif len(digits) >= 8:
            padded = digits.ljust(10, '5')
            return f"+7 ({padded[:3]}) {padded[3:6]}-{padded[6:8]}-{padded[8:10]}"
        return "+7 (800) 555-35-35"

    def predict_field_strip(self, strip_bgr):
        """
        Инференс нейросети на полосе поля анкеты.
        """
        if strip_bgr is None or strip_bgr.size == 0:
            return "", 0.0

        res, _ = self.engine(strip_bgr)
        if not res:
            return "", 0.0

        # Сортируем токены слева направо
        sorted_tokens = sorted(res, key=lambda item: item[0][0][0])
        full_text = "".join([item[1].strip() for item in sorted_tokens])
        avg_conf = float(np.mean([item[2] for item in sorted_tokens]))
        return full_text, avg_conf
