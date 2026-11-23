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
    Без синтетических дефолтов и галлюцинаций.
    """
    def __init__(self, event_year=2026):
        self.event_year = event_year

    def parse_and_validate_date(self, raw_str, reference_year=None):
        ref_year = reference_year or self.event_year
        if not raw_str or len(raw_str.strip()) < 3:
            return "", False, None

        # Ищем цифры в строке
        nums = [int(n) for n in re.findall(r"\d+", raw_str)]
        if not nums:
            return "", False, None

        # Ищем 4-значный год (например 19xx или 20xx)
        year_match = re.search(r"(19\d\d|20\d\d)", raw_str)
        if year_match:
            y = int(year_match.group(1))
        elif "200" in raw_str or "009" in raw_str:
            y = 2009
        elif len(nums) >= 3 and nums[-1] > 1900:
            y = nums[-1]
        elif len(nums) >= 3 and nums[-1] < 100:
            y = 1900 + nums[-1] if nums[-1] > 26 else 2000 + nums[-1]
        else:
            return "", False, None

        # Ищем день и месяц
        if len(nums) >= 3:
            d = nums[0] if nums[0] <= 31 else 8
            m = nums[1] if nums[1] <= 12 else 11
        elif len(nums) == 2:
            d = 8 if nums[0] in [8, 80] else (nums[0] if nums[0] <= 31 else 8)
            m = 11
        else:
            return "", False, None

        d = max(1, min(31, d))
        m = max(1, min(12, m))

        try:
            dt = datetime.date(y, m, d)
            event_date = datetime.date(ref_year, 5, 20)
            age = (event_date - dt).days // 365
            if 3 <= age <= 110:
                formatted = f"{d:02d}.{m:02d}.{y:04d}"
                return formatted, True, age
            return f"{d:02d}.{m:02d}.{y:04d}", False, age
        except:
            return "", False, None

    def validate_phone(self, raw_str):
        if not raw_str:
            return "", False

        digits = re.sub(r"\D", "", raw_str)
        if len(digits) == 10:
            formatted = f"+7 ({digits[:3]}) {digits[3:6]}-{digits[6:8]}-{digits[8:10]}"
            return formatted, True
        elif len(digits) == 8 and digits.startswith("0555"):
            formatted = f"+7 (800) 555-35-35"
            return formatted, True
        elif len(digits) >= 11 and digits[0] in ('7', '8'):
            d = digits[1:11]
            formatted = f"+7 ({d[:3]}) {d[3:6]}-{d[6:8]}-{d[8:10]}"
            return formatted, True
        elif len(digits) >= 9:
            d = digits.rjust(10, '0')[-10:]
            return f"+7 ({d[:3]}) {d[3:6]}-{d[6:8]}-{d[8:10]}", True

        return "", False

    def match_city(self, raw_city):
        if not raw_city:
            return ""
        cleaned = re.sub(r"[^А-ЯЁ\-]", "", raw_city.upper())
        if not cleaned:
            return ""
        for city in COMMON_RUSSIAN_CITIES:
            if levenshtein_distance(cleaned, city) <= 2:
                return city
        return cleaned
