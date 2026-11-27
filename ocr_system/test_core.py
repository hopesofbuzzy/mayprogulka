"""Targeted model tests using the public synthetic sample and generated v3 images."""

import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .classifier import DeepLearningOCRClassifier
from .pipeline import FIELDS, TEMPLATE, FormOCRPipeline, RejectedForm, normalize


ROOT = Path(__file__).resolve().parents[1]
COMMON = ('СМИРНОВ', 'АЛЕКСАНДР', 'СЕРГЕЕВИЧ', '1992-06-14', '+79126482190', 'SMIRNOV@mail.ru')
SAMPLES = [
    ('ПЕТРОВ', 'АННА', 'ИВАНОВНА', '1986-12-25', '+79001234567', 'MIRA@example.com'),
    ('ОРЛОВА-ВОСКРЕСЕНСКАЯ', 'МАРИЯ', 'ПЕТРОВНА', '2001-11-08', '+79102030405', 'WALK.TEST9@example.com'),
    ('СОКОЛОВ', 'ТИМОФЕЙ', 'ИЛЬИЧ', '1974-04-03', '+79990000222', 'CORE+01@example.com'),
    ('СИДОРОВА', 'ВЕРА', '', '1999-02-27', '+79876543210', 'V.test@example.org'),
    ('ЛЕВИН', 'ЛЕВ', 'ОЛЕГОВИЧ', '1996-05-17', '+79991112233', 'LEV@example.net'),
    ('МАКСИМОВА', 'МИЛА', 'ЛЬВОВНА', '2000-10-20', '+79012345678', 'MILA@example.org'),
]
# Straight/curved pen strokes drawn independently of the printed font.
STROKES = {
    'Л': [[(3, 15), (8, 2), (14, 16)]],
    'Е': [[(13, 2), (4, 2), (3, 15), (14, 15)], [(4, 8), (11, 8)]],
    'В': [[(4, 15), (4, 2), (11, 2), (13, 4), (12, 7), (4, 8), (11, 8), (14, 11), (12, 15), (4, 15)]],
    'М': [[(1, 16), (3, 2), (8, 10), (14, 2), (16, 16)]],
    'И': [[(3, 2), (3, 15), (14, 2), (14, 16)]],
    'А': [[(2, 16), (8, 2), (15, 16)], [(5, 11), (12, 11)]],
}


def synthetic_form(values, hand=False, incomplete=False):
    image = Image.open(TEMPLATE).convert('RGB')
    draw = ImageDraw.Draw(image)
    fonts = Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts'
    font = ImageFont.truetype(str(fonts / 'arialbd.ttf'), 22)
    surname, name, middle, birthday, phone, email = values
    year, month, day = birthday.split('-')
    text_groups = [(surname,), (name,), (middle,), (day, month, year), (phone[2:],), (email,)]
    if incomplete:
        text_groups[3] = (day, month, year[:2])
        text_groups[4] = (phone[2:9],)
        text_groups[5] = (email.split('@')[0],)
    for (y, groups), texts in zip(FIELDS.values(), text_groups):
        for (start, count), text in zip(groups, texts):
            assert len(text) <= count
            for index, char in enumerate(text):
                x = start + 32 * index
                if hand and y == 230 and char in STROKES:
                    for line in STROKES[char]:
                        draw.line([(x + 5 + px, y + 6 + py + index % 2) for px, py in line],
                                  fill='#15206b', width=2, joint='curve')
                else:
                    draw.text((x + 14, y + 17), char, font=font, anchor='mm', fill='#15206b')
    pixels = cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR)
    if hand:
        src = np.float32([[0, 0], [1199, 0], [1199, 1599], [0, 1599]])
        dst = np.float32([[89, 97], [1244, 48], [1280, 1730], [105, 1680]])
        pixels = cv2.warpPerspective(pixels, cv2.getPerspectiveTransform(src, dst), (1370, 1790),
                                     borderValue=(202, 197, 182))
        _, encoded = cv2.imencode('.jpg', pixels, [cv2.IMWRITE_JPEG_QUALITY, 81])
        pixels = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
    return pixels


class ModelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pipeline = FormOCRPipeline()

    def test_reference_and_synthetic(self):
        forms = [(cv2.imread(str(ROOT / 'assets' / 'sample_filled_test.png')), COMMON)]
        forms.extend((synthetic_form(sample, hand=i >= 4), sample) for i, sample in enumerate(SAMPLES))
        exact = expected = optional_empty = 0
        totals = {field: [0, 0] for field in FIELDS}
        for index, (image, truth) in enumerate(forms):
            result = self.pipeline.process_image(image)
            self.assertEqual(result['status'], 'review_required')
            self.assertEqual(set(result['fields']), set(FIELDS))
            differences = {}
            for (field, candidate), value in zip(result['fields'].items(), truth):
                if value:
                    expected += 1
                    totals[field][1] += 1
                    if candidate['value'] == value:
                        exact += 1
                        totals[field][0] += 1
                    else:
                        differences[field] = [value, candidate['value'], candidate['raw']]
                else:
                    self.assertIsNone(candidate['value'])
                    optional_empty += 1
            print(f'case {index}: {ascii(differences)}')
        print(f'exact fields {exact}/{expected}; optional empty {optional_empty}; per field {totals}')

    def test_empty_foreign_and_wrong_footer(self):
        blank = cv2.imread(str(TEMPLATE))
        foreign = np.full((400, 400, 3), 255, dtype=np.uint8)
        wrong_footer = synthetic_form(SAMPLES[0])
        wrong_footer[1548:1580, 900:1140] = 255
        for image in (blank, foreign, wrong_footer):
            with self.subTest(shape=image.shape), self.assertRaises(RejectedForm):
                self.pipeline.process_image(image)

    def test_missing_model_fails_explicitly(self):
        with TemporaryDirectory() as directory, self.assertRaisesRegex(FileNotFoundError, 'PP-OCRv6 Medium'):
            DeepLearningOCRClassifier(Path(directory))

    def test_incomplete_fields_stay_empty(self):
        result = self.pipeline.process_image(synthetic_form(SAMPLES[0], incomplete=True))
        for field in ('date_of_birth', 'phone_number', 'email'):
            with self.subTest(field=field):
                self.assertTrue(result['fields'][field]['raw'])
                self.assertIsNone(result['fields'][field]['value'])
        self.assertIsNone(normalize('date_of_birth', '29.02.1999'))


if __name__ == '__main__':
    unittest.main()

