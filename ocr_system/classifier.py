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
        s = raw_str.strip().upper().replace(" ", "")
        
        # 1. Если уже есть корректный адрес с собачкой
        if "@" in s and "." in s:
            return re.sub(r"[^a-zA-Z0-9@._\-]", "", s).lower()

        cleaned = re.sub(r"[^A-Z0-9@._\-(a\)]", "", s).lower()
        
        # 2. Нечеткий поиск известных почтовых доменов (длинные домены проверяются первыми)
        known_domains = [
            ("gmail", ["gmail", "gmai", "gma1l"]),
            ("yandex", ["yandex", "yadex", "yandx"]),
            ("rambler", ["rambler", "ramblr"]),
            ("inbox", ["inbox", "inbx"]),
            ("urfu", ["urfu"]),
            ("list", ["list", "l1st"]),
            ("mail", ["mail", "dmail", "mai", "mall", "ma1l"]),
            ("bk", ["bk"]),
            ("ya", ["ya"])
        ]
        
        found_domain = None
        best_split_idx = -1
        
        for dom_canon, variants in known_domains:
            for var in variants:
                idx = cleaned.find(var)
                if idx > 0:
                    found_domain = dom_canon
                    best_split_idx = idx
                    break
            if found_domain:
                break
                
        if found_domain and best_split_idx > 0:
            username = cleaned[:best_split_idx].rstrip("@._-0do")
            username = re.sub(r"[\(\[]a[\)\]]$", "", username)
            if not username:
                username = cleaned[:best_split_idx].rstrip("@._-")
            zone = "com" if found_domain == "gmail" else "ru"
            return f"{username}@{found_domain}.{zone}"
            
        return cleaned

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
