import cv2
import numpy as np

class DocumentAligner:
    """
    Детектирует реперные маркеры (4 черных угла) и выравнивает перспективу документа.
    """
    def __init__(self, target_w=1200, target_h=1600):
        self.target_w = target_w
        self.target_h = target_h

    def align(self, image_np):
        """
        Принимает BGR изображение с камеры, находит 4 опорных маркера и возвращает
        выровненное плоское изображение 1200x1600.
        """
        gray = cv2.cvtColor(image_np, cv2.COLOR_BGR2GRAY)
        h, w = gray.shape

        # Поиск черных квадратов-маркеров по углам (в 4 квадрантах)
        quadrants = [
            (0, 0, w // 3, h // 3),                 # Top-Left
            (2 * w // 3, 0, w, h // 3),             # Top-Right
            (2 * w // 3, 2 * h // 3, w, h),         # Bottom-Right
            (0, 2 * h // 3, w // 3, h)              # Bottom-Left
        ]

        detected_centers = []

        # Бинаризация для поиска темных меток
        _, thresh = cv2.threshold(gray, 60, 255, cv2.THRESH_BINARY_INV)

        for qx1, qy1, qx2, qy2 in quadrants:
            quad_thresh = thresh[qy1:qy2, qx1:qx2]
            contours, _ = cv2.findContours(quad_thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

            best_marker = None
            max_area = 0

            for cnt in contours:
                area = cv2.contourArea(cnt)
                if area < 80:  # слишком мелкий шум
                    continue
                peri = cv2.arcLength(cnt, True)
                approx = cv2.approxPolyDP(cnt, 0.04 * peri, True)
                
                # Ищем четырехугольник или плотное пятно маркера
                x, y, bw, bh = cv2.boundingRect(cnt)
                aspect = float(bw) / bh if bh > 0 else 0
                if 0.7 <= aspect <= 1.4:  # близко к квадрату
                    if area > max_area:
                        max_area = area
                        M = cv2.moments(cnt)
                        if M["m00"] != 0:
                            cx = int(M["m10"] / M["m00"]) + qx1
                            cy = int(M["m01"] / M["m00"]) + qy1
                            best_marker = (cx, cy)

            if best_marker:
                detected_centers.append(best_marker)

        # Если найдены 4 маркера — рассчитываем гомографию
        if len(detected_centers) == 4:
            src_pts = np.float32(detected_centers)
            # Эталонные координаты центров меток на бланке 1200x1600
            dst_pts = np.float32([
                [50, 50],
                [self.target_w - 50, 50],
                [self.target_w - 50, self.target_h - 50],
                [50, self.target_h - 50]
            ])
            matrix = cv2.getPerspectiveTransform(src_pts, dst_pts)
            warped = cv2.warpPerspective(image_np, matrix, (self.target_w, self.target_h))
            return warped, True

        # Если маркеры частично скрыты — пробуем подогнать по размерам листа
        resized = cv2.resize(image_np, (self.target_w, self.target_h))
        return resized, False
