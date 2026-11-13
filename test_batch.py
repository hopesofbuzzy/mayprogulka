import sys
sys.stdout.reconfigure(encoding='utf-8')
from ocr_system.mock_filler import create_filled_sample
from ocr_system.pipeline import FormOCRPipeline

pipeline = FormOCRPipeline()

cases = [
    ('ИВАНОВ', 'ИВАН', 'ИВАНОВИЧ', '21', '03', '1985', 'M', '9041234567', 'ЕКАТЕРИНБУРГ', '02', 0, '012345'),
    ('ПЕТРОВА', 'АННА', 'ПАВЛОВНА', '05', '11', '2001', 'F', '9509876543', 'НИЖНИЙ ТАГИЛ', '00', 2, '009812'),
    ('КУЗНЕЦОВ', 'ДМИТРИЙ', 'ОЛЕГОВИЧ', '12', '07', '1978', 'M', '9120001122', 'ПЕРВОУРАЛЬСК', '10', 3, '054321')
]

for sur, nam, pat, d, m, y, g, ph, c, pr, dist_idx, card in cases:
    img = create_filled_sample(sur, nam, pat, d, m, y, g, ph, c, pr, dist_idx, card, add_noise=True)
    res = pipeline.process_image(img)
    data = res['data']
    print(f"Original: {sur} {nam} {pat} ({c})")
    print(f"Recognized: {data['surname']} {data['name']} {data['patronymic']} ({data['city']})")
    print(f"Birth: {data['birth_date']}, Dist: {data['distance']}, Status: {res['status']}, Conf: {res['overall_confidence']}%")
    print("-" * 60)
