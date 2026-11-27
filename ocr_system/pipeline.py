import re
from datetime import date
from pathlib import Path

import cv2
import numpy as np

from .aligner import DocumentAligner
from .classifier import DeepLearningOCRClassifier


TEMPLATE = Path(__file__).with_name('sample_form_template.png')
# (row top, groups of (first cell x, number of cells)), in generator coordinates.
FIELDS = {
    'surname': (175, [(220, 24)]),
    'name': (230, [(220, 24)]),
    'middle_name': (285, [(220, 24)]),
    'date_of_birth': (340, [(220, 2), (302, 2), (384, 4)]),
    'phone_number': (395, [(220, 10)]),
    'email': (450, [(220, 24)]),
}
# Fixed header and version footer, in addition to all four ArUco markers.
TEMPLATE_REGIONS = [(233, 47, 968, 75), (926, 1554, 1115, 1570)]
MIN_CONFIDENCE = 0.82


class RejectedForm(ValueError):
    pass


def normalize(field, raw):
    text = raw.strip()
    if field == 'date_of_birth':
        match = re.fullmatch(r'([0-9]{2})\.([0-9]{2})\.([0-9]{4})', text)
        if match:
            day, month, year = map(int, match.groups())
            try:
                birthday = date(year, month, day)
                return birthday.isoformat() if birthday < date(2026, 5, 17) else None
            except ValueError:
                return None
        return None
    if field == 'phone_number':
        # +7 is preprinted. The ten remaining cells must all be read.
        return '+7' + text if re.fullmatch(r'[0-9]{10}', text) else None
    if field == 'email':
        if re.fullmatch(r"[A-Za-z0-9_%+-]+(?:\.[A-Za-z0-9_%+-]+)*@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}", text):
            local, domain = text.rsplit('@', 1)
            return local + '@' + domain.lower()
        return None
    return text.upper() if re.fullmatch(r"[А-Яа-яЁё]+(?:[ '-][А-Яа-яЁё]+)*", text) else None


def field_groups(gray, y, groups):
    """Separate ink from the printed grid, keeping every cell in each field."""
    result = []
    for start, count in groups:
        cells = []
        for x in range(start, start + count * 32, 32):
            interior = gray[y + 3:y + 28, x + 3:x + 26]
            ink = np.where(interior < 112, 0, 255).astype(np.uint8)
            cells.append((ink, np.count_nonzero(ink == 0) >= 5))
        occupied = [index for index, (_, marked) in enumerate(cells) if marked]
        if not occupied:
            result.append((None, 0, True))
            continue
        last = occupied[-1]
        line = np.hstack([ink for ink, _ in cells[:last + 1]])
        line = cv2.copyMakeBorder(line, 4, 4, 4, 4, cv2.BORDER_CONSTANT, value=255)
        result.append((cv2.cvtColor(line, cv2.COLOR_GRAY2BGR), last + 1, len(occupied) == last + 1))
    return result


class FormOCRPipeline:
    def __init__(self):
        self.aligner = DocumentAligner()
        self.classifier = DeepLearningOCRClassifier()
        reference = cv2.imdecode(np.fromfile(TEMPLATE, dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
        if reference is None:
            raise RuntimeError('Missing v3 template reference')
        self.template_regions = [reference[y1:y2, x1:x2] for x1, y1, x2, y2 in TEMPLATE_REGIONS]

    def process_image(self, image):
        aligned, ok = self.aligner._align_aruco(image)
        if not ok:
            raise RejectedForm('Нужен бланк v3 с четырьмя видимыми угловыми метками.')
        gray = cv2.cvtColor(aligned, cv2.COLOR_BGR2GRAY)
        for (x1, y1, x2, y2), template in zip(TEMPLATE_REGIONS, self.template_regions):
            search = gray[y1 - 5:y2 + 5, x1 - 5:x2 + 5]
            score = cv2.matchTemplate(search, template, cv2.TM_CCOEFF_NORMED).max()
            if score < 0.62:
                raise RejectedForm('Заголовок или версия бланка v3 не подтверждены.')

        strips = {key: field_groups(gray, *area) for key, area in FIELDS.items()}
        if not any(count for groups in strips.values() for _, count, _ in groups):
            raise RejectedForm('Бланк пуст.')

        candidates = {}
        for field, groups in strips.items():
            readings = [self.classifier.predict_field_strip(strip) if strip is not None else ('', None)
                        for strip, _, _ in groups]
            tokens = [raw for raw, _ in readings]
            raw = '.'.join(tokens) if field == 'date_of_birth' and any(tokens) else ''.join(tokens)
            scores = [score for _, score in readings if score is not None]
            value = normalize(field, raw)
            confidence = min(scores) if scores else None
            if not raw:
                reason = 'нет читаемой записи'
            elif confidence is None or confidence < MIN_CONFIDENCE:
                reason = 'низкая уверенность модели'
            elif value is None or any(len(text.strip()) != count or not contiguous
                                     for (text, _), (_, count, contiguous) in zip(readings, groups)):
                reason = 'неполное или неоднозначное значение'
            else:
                reason = None
            candidates[field] = {'raw': raw, 'confidence': confidence, 'value': value if not reason else None, 'reason': reason}
        return {'status': 'review_required', 'fields': candidates}

