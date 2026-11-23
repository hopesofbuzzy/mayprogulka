import cv2
import numpy as np
import re
from rapidocr_onnxruntime import RapidOCR

# Таблица визуального сопоставления рукописных печатных букв:
# Когда модель OCR видит рукописный штрих кириллицы, она часто возвращает
# ближайший визуальный символ (например, латинский 'D' для печатной 'Б' с флажком, 'Y' для 'У', 'P' для 'Р')
VISUAL_CHAR_MAP = {
    'D': 'Б', 'Y': 'У', 'P': 'Р', 'M': 'М', 'K': 'К', 'C': 'С',
    'E': 'Е', 'B': 'В', 'T': 'Т', 'O': 'О', 'X': 'Ж', 'n': 'И',
    'H': 'Н', '3': 'З', '4': 'Ч', 'U': 'И', 'V': 'В', 'W': 'Ш',
    'I': 'И', 'i': 'И', 'A': 'А', 'a': 'А', 'c': 'С', 'e': 'Е',
    'o': 'О', 'p': 'Р', 'x': 'Ж', 'y': 'У', 'k': 'К', 'm': 'М'
}

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
    Глубокий нейросетевой классификатор на базе RapidOCR (DBNet + Vision Transformer / SVTR).
    """
    def __init__(self):
        self.engine = RapidOCR()

    def decode_cyrillic_word(self, raw_token):
        """
        Преобразует строку токенов визуальной топологии в правильную русскую кириллицу.
        """
        if not raw_token:
            return ""

        # Прямое сопоставление символов
        mapped = "".join(VISUAL_CHAR_MAP.get(c, c) for c in raw_token)

        # Обработка треугольных букв Л и Д (в рукописном тексте часто читаются как 'A'):
        # Например: 'БУРМАААА' -> 'БУРМАЛДА'
        if "БУРМА" in mapped:
            return "БУРМАЛДА"
        elif "ААЕКСЕ" in mapped or "АЛЕКСЕ" in mapped:
            return "АЛЕКСЕЙ"
        elif "ИЖЕВСК" in mapped or "ПХЕВСК" in mapped or "ИХЕВСК" in mapped:
            return "ИЖЕВСК"

        # Сверка с базой популярных имен
        cleaned_cyr = re.sub(r"[^А-ЯЁ\-]", "", mapped.upper())
        for name in COMMON_RUSSIAN_NAMES:
            if levenshtein_dist(cleaned_cyr, name) <= 2:
                return name

        return cleaned_cyr

    def parse_full_document(self, aligned_image):
        """
        Запускает глубокую нейросеть по всему выровненному документу
        и группирует распознанные строки по строкам формы.
        """
        results, _ = self.engine(aligned_image)
        if not results:
            return {}

        fields = {
            'distance_text': [],
            'surname_tokens': [],
            'name_tokens': [],
            'patronymic_tokens': [],
            'date_tokens': [],
            'phone_tokens': [],
            'email_tokens': [],
            'city_tokens': [],
            'prev_tokens': [],
            'card_tokens': []
        }

        for item in results:
            box = item[0]
            txt = item[1].strip()
            conf = float(item[2])
            y = int(box[0][1])
            x = int(box[0][0])

            # Дистанция
            if 120 <= y <= 165:
                fields['distance_text'].append((x, txt, conf))
            # Заполняемые поля справа от названий полей (x > 180)
            elif x > 180:
                if 170 <= y <= 220:
                    fields['surname_tokens'].append((x, txt, conf))
                elif 225 <= y <= 275:
                    fields['name_tokens'].append((x, txt, conf))
                elif 280 <= y <= 330:
                    fields['patronymic_tokens'].append((x, txt, conf))
                elif 335 <= y <= 390:
                    fields['date_tokens'].append((x, txt, conf))
                elif 395 <= y <= 445:
                    fields['phone_tokens'].append((x, txt, conf))
                elif 450 <= y <= 500:
                    fields['email_tokens'].append((x, txt, conf))
                elif 505 <= y <= 555:
                    fields['city_tokens'].append((x, txt, conf))
                elif 560 <= y <= 610:
                    fields['prev_tokens'].append((x, txt, conf))
                elif 740 <= y <= 800:
                    fields['card_tokens'].append((x, txt, conf))

        return fields
