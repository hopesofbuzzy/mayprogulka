from pathlib import Path

from rapidocr_onnxruntime import RapidOCR


MODEL_DIR = Path(__file__).resolve().parent / 'models' / 'pp_v6_medium'


class DeepLearningOCRClassifier:
    """Recognize aligned field strips with Yulia's PP-OCRv6 Medium weights."""

    def __init__(self, model_dir=MODEL_DIR):
        model = model_dir / 'inference.onnx'
        dictionary = model_dir / 'dict.txt'
        if not model.is_file() or not dictionary.is_file():
            raise FileNotFoundError(f'PP-OCRv6 Medium: required files missing in {model_dir}')
        self.engine = RapidOCR(
            rec_model_path=str(model), rec_keys_path=str(dictionary),
            intra_op_num_threads=2, inter_op_num_threads=1,
        )

    def predict_field_strip(self, strip_bgr):
        # The v3 grid supplies the text region and orientation.
        result, _ = self.engine(strip_bgr, use_det=False, use_cls=False)
        if not result:
            return '', None
        raw, confidence = result[0][:2]
        return raw, float(confidence)

