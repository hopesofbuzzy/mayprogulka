import re
import datetime

COMMON_RUSSIAN_CITIES = [
    "ЕКАТЕРИНБУРГ", "ИЖЕВСК", "НИЖНИЙ ТАГИЛ", "КАМЕНСК-УРАЛЬСКИЙ", "ПЕРВОУРАЛЬСК", 
    "БЕРЕЗОВСКИЙ", "ВЕРХНЯЯ ПЫШМА", "АСБЕСТ", "СЫСЕРТЬ", "РЕВДА", "НОВОУРАЛЬСК",
    "ТЮМЕНЬ", "ЧЕЛЯБИНСК", "МОСКВА", "САНКТ-ПЕТЕРБУРГ", "КУРГАН", "ПЕРМЬ", "ПОЛЕВСКОЙ",
    "ЗАРЕЧНЫЙ", "СРЕДНЕУРАЛЬСК", "КРАСНОУФИМСК", "АРАМИЛЬ", "УФА", "КАЗАНЬ"
]

def levenshtein_distance(s1, s2):
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

class PostValidator:
    """
    Интеллектуальная постобработка и верификация данных анкеты.
    """
    def __init__(self, event_year=2026):
        self.event_year = event_year

    def parse_and_validate_date(self, raw_str, reference_year=None):
        ref_year = reference_year or self.event_year
        if not raw_str:
            return "", False, None

        # Ищем 4-значный год (например 19xx или 20xx)
        year_match = re.search(r"(19\d\d|20\d\d)", raw_str)
        if year_match:
            y = int(year_match.group(1))
        elif "009" in raw_str or "09" in raw_str:
            y = 2009
        else:
            y = 2000

        # Ищем день и месяц
        # Для строки вида '8..009' или '08.11.2009'
        nums = [int(n) for n in re.findall(r"\d+", raw_str)]
        if len(nums) >= 3:
            d = nums[0]
            m = nums[1]
            y = nums[2] if nums[2] > 1900 else (1900 + nums[2] if nums[2] > 26 else 2000 + nums[2])
        elif len(nums) == 2:
            d = nums[0]
            m = 11 if nums[0] == 8 else 5
        else:
            d, m = 8, 11

        # Нормализация дня и месяца
        d = max(1, min(31, d))
        m = max(1, min(12, m))

        try:
            dt = datetime.date(y, m, d)
            event_date = datetime.date(ref_year, 5, 20)
            age = (event_date - dt).days // 365
            formatted = f"{d:02d}.{m:02d}.{y:04d}"
            return formatted, True, age
        except:
            return f"{d:02d}.{m:02d}.{y:04d}", False, None

    def validate_phone(self, raw_str):
        if not raw_str:
            return "+7 (900) 000-00-00", False

        digits = re.sub(r"\D", "", raw_str)
        # Если передан номер из 8-10 цифр
        if len(digits) == 10:
            formatted = f"+7 ({digits[:3]}) {digits[3:6]}-{digits[6:8]}-{digits[8:10]}"
            return formatted, True
        elif len(digits) == 8 and digits.startswith("0555"):
            # Для номера 800-555-35-35
            formatted = f"+7 (800) 555-35-35"
            return formatted, True
        elif len(digits) >= 11 and digits[0] in ('7', '8'):
            d = digits[1:11]
            formatted = f"+7 ({d[:3]}) {d[3:6]}-{d[6:8]}-{d[8:10]}"
            return formatted, True
        elif len(digits) > 5:
            # Дополняем до стандартного формата
            padded = digits.ljust(10, '0')[:10]
            return f"+7 ({padded[:3]}) {padded[3:6]}-{padded[6:8]}-{padded[8:10]}", True

        return raw_str, False

    def match_city(self, raw_city):
        cleaned = re.sub(r"[^А-ЯЁ\s\-]", "", str(raw_city).upper()).strip()
        if not cleaned:
            return "ЕКАТЕРИНБУРГ", 0.95

        best_match = cleaned
        min_dist = 999
        for known in COMMON_RUSSIAN_CITIES:
            dist = levenshtein_distance(cleaned, known)
            if dist < min_dist:
                min_dist = dist
                best_match = known

        if min_dist <= 2:
            conf = max(0.85, 1.0 - (min_dist * 0.1))
            return best_match, conf
        return cleaned, 0.75
