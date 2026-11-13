import re
import datetime

COMMON_RUSSIAN_CITIES = [
    "ЕКАТЕРИНБУРГ", "НИЖНИЙ ТАГИЛ", "КАМЕНСК-УРАЛЬСКИЙ", "ПЕРВОУРАЛЬСК", 
    "БЕРЕЗОВСКИЙ", "ВЕРХНЯЯ ПЫШМА", "АСБЕСТ", "СЫСЕРТЬ", "РЕВДА", "НОВОУРАЛЬСК",
    "ТЮМЕНЬ", "ЧЕЛЯБИНСК", "МОСКВА", "САНКТ-ПЕТЕРБУРГ", "КУРГАН", "ПЕРМЬ"
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
    Интеллектуальная постобработка и верификация с поддержкой динамического года мероприятия:
    - очистка пробелов и артефактов
    - выравнивание телефонных номеров (+7-XXX-XXX-XX-XX)
    - проверка валидности календарных дат с динамическим расчетом возраста относительно event_year
    - исправление городов по справочнику
    """
    def __init__(self, event_year=None):
        self.event_year = event_year or datetime.date.today().year

    def clean_text(self, raw_text):
        return raw_text.strip()

    def validate_date(self, day_str, month_str, year_str, reference_year=None):
        ref_year = reference_year or self.event_year
        day = day_str.strip()
        month = month_str.strip()
        year = year_str.strip()

        char_map = {'O': '0', 'I': '1', 'L': '1', 'Z': '2', 'S': '5', 'B': '8'}
        for k, v in char_map.items():
            day = day.replace(k, v)
            month = month.replace(k, v)
            year = year.replace(k, v)

        try:
            d = int(day)
            m = int(month)
            y = int(year)
            if y < 100:
                century = (ref_year // 100) * 100
                cutoff = ref_year % 100
                y = century + y if y <= cutoff else (century - 100) + y

            dt = datetime.date(y, m, d)
            event_date = datetime.date(ref_year, 5, 20)
            age = (event_date - dt).days // 365
            is_valid = (3 <= age <= 100)
            formatted = f"{d:02d}.{m:02d}.{y:04d}"
            return formatted, is_valid, age
        except:
            return f"{day}.{month}.{year}", False, None

    def validate_phone(self, raw_digits):
        digits = re.sub(r"\D", "", raw_digits)
        if len(digits) == 10:
            formatted = f"+7 ({digits[:3]}) {digits[3:6]}-{digits[6:8]}-{digits[8:10]}"
            return formatted, True
        elif len(digits) == 11 and (digits[0] in ('7', '8')):
            d = digits[1:]
            formatted = f"+7 ({d[:3]}) {d[3:6]}-{d[6:8]}-{d[8:10]}"
            return formatted, True
        return raw_digits.strip(), False

    def match_city(self, raw_city):
        cleaned = raw_city.strip().upper()
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
            return best_match, max(0.85, 1.0 - (min_dist * 0.1))
        return cleaned, 0.70
