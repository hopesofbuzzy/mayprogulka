import re
import datetime

_DATE_DIGIT_MAP = str.maketrans({
    "О": "0", "о": "0", "O": "0", "o": "0", "D": "0",
    "I": "1", "l": "1", "|": "1",
    "З": "3", "з": "3",
    "Ч": "4", "ч": "4",
    "S": "5", "s": "5",
    "Б": "6", "б": "6",
    "В": "8",
    "g": "9",
})


class PostValidator:
    """
    Постобработка и честная валидация данных анкеты без подмен и захардкоженных дефолтов.
    """

    def __init__(self, event_year=2026):
        self.event_year = event_year

    def parse_and_validate_date(self, raw_str, reference_year=None):
        ref_year = reference_year or self.event_year
        if not raw_str or len(raw_str.strip()) < 3:
            return "", False, None

        normalized = raw_str.translate(_DATE_DIGIT_MAP)
        digits_only = re.sub(r"\D", "", normalized)
        nums = [int(n) for n in re.findall(r"\d+", normalized)]

        d = m = y = None

        # Вариант 1: ровно 8 слитных цифр DDMMYYYY (типичный выход из 8 ячеек даты)
        if len(digits_only) == 8:
            d = int(digits_only[0:2])
            m = int(digits_only[2:4])
            y = int(digits_only[4:8])
        # Вариант 2: разделенные числа (ДД.ММ.ГГГГ или ДД.ММ.ГГ)
        elif len(nums) >= 3:
            d, m, y_raw = nums[0], nums[1], nums[2]
            if 1900 <= y_raw <= 2100:
                y = y_raw
            elif 0 <= y_raw < 100:
                y = 1900 + y_raw if y_raw > (ref_year % 100) else 2000 + y_raw
        else:
            return "", False, None

        if y is None or not (1 <= d <= 31 and 1 <= m <= 12):
            return "", False, None

        try:
            dt = datetime.date(y, m, d)
            event_date = datetime.date(ref_year, 5, 20)
            age = (event_date - dt).days // 365
            formatted = f"{d:02d}.{m:02d}.{y:04d}"
            is_valid = 3 <= age <= 110
            return formatted, is_valid, age
        except ValueError:
            return "", False, None

    def validate_phone(self, raw_str):
        if not raw_str:
            return "", False

        digits = re.sub(r"\D", "", raw_str.translate(_DATE_DIGIT_MAP))
        if len(digits) == 11 and digits[0] in ("7", "8"):
            d = digits[1:]
            return f"+7 ({d[:3]}) {d[3:6]}-{d[6:8]}-{d[8:10]}", True
        if len(digits) == 10:
            return f"+7 ({digits[:3]}) {digits[3:6]}-{digits[6:8]}-{digits[8:10]}", True
        return digits, False
