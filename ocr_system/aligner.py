import cv2
import numpy as np

class DocumentAligner:
    """
    Интеллектуальное выравнивание перспективы бланка анкеты:
    1. Стратегия 1: Детекция ArUco-маркеров (0=TL, 1=TR, 2=BR, 3=BL).
    2. Стратегия 2: Детекция 4 угловых черных реперных квадратов (для классического бланка).
    3. Стратегия 3: Детекция внешнего контура листа бумаги (CamScanner-подход).
    """
    def __init__(self, target_w=1200, target_h=1600):
        self.target_w = target_w
        self.target_h = target_h
        self.aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
        self.detector = cv2.aruco.ArucoDetector(self.aruco_dict)

        self.dst_centers = {
            0: [50.0, 50.0],
            1: [float(self.target_w - 50), 50.0],
            2: [float(self.target_w - 50), float(self.target_h - 50)],
            3: [50.0, float(self.target_h - 50)]
        }

    def _align_aruco(self, image_np):
        gray = cv2.cvtColor(image_np, cv2.COLOR_BGR2GRAY)
        corners, ids, _ = self.detector.detectMarkers(gray)

        if ids is not None and len(ids) >= 4:
            id_map = {}
            for i in range(len(ids)):
                mid = int(ids[i][0]) if hasattr(ids[i], '__len__') else int(ids[i])
                id_map[mid] = corners[i][0]

            if all(k in id_map for k in [0, 1, 2, 3]):
                src_pts = []
                dst_pts = []
                for k in [0, 1, 2, 3]:
                    marker_corners = id_map[k]
                    cx = float(np.mean(marker_corners[:, 0]))
                    cy = float(np.mean(marker_corners[:, 1]))
                    src_pts.append([cx, cy])
                    dst_pts.append(self.dst_centers[k])

                matrix = cv2.getPerspectiveTransform(np.float32(src_pts), np.float32(dst_pts))
                warped = cv2.warpPerspective(image_np, matrix, (self.target_w, self.target_h))
                return warped, True

        return None, False

    def _align_black_squares(self, image_np):
        """
        Детекция 4 черных угловых меток-квадратов (для стандартного бланка).
        """
        gray = cv2.cvtColor(image_np, cv2.COLOR_BGR2GRAY)
        h, w = gray.shape

        # Бинаризация темных меток
        _, thresh = cv2.threshold(gray, 90, 255, cv2.THRESH_BINARY_INV)
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        quadrants = {
            'TL': (0, 0, w // 2, h // 2),
            'TR': (w // 2, 0, w, h // 2),
            'BR': (w // 2, h // 2, w, h),
            'BL': (0, h // 2, w // 2, h)
        }

        detected = {}
        for q_name, (qx1, qy1, qx2, qy2) in quadrants.items():
            max_area = 0
            best_pt = None
            for cnt in contours:
                area = cv2.contourArea(cnt)
                if 100 < area < 6000:
                    x, y, bw, bh = cv2.boundingRect(cnt)
                    aspect = float(bw) / bh if bh > 0 else 0
                    if 0.6 <= aspect <= 1.5:
                        M = cv2.moments(cnt)
                        if M['m00'] != 0:
                            cx = int(M['m10'] / M['m00'])
                            cy = int(M['m01'] / M['m00'])
                            if qx1 <= cx <= qx2 and qy1 <= cy <= qy2 and area > max_area:
                                max_area = area
                                best_pt = (cx, cy)
            detected[q_name] = best_pt

        # Если найдены все 4 угла
        if all(detected[k] is not None for k in ['TL', 'TR', 'BR', 'BL']):
            src_pts = np.float32([
                detected['TL'],
                detected['TR'],
                detected['BR'],
                detected['BL']
            ])
            dst_pts = np.float32([
                [50, 50],
                [self.target_w - 50, 50],
                [self.target_w - 50, self.target_h - 50],
                [50, self.target_h - 50]
            ])
            matrix = cv2.getPerspectiveTransform(src_pts, dst_pts)
            warped = cv2.warpPerspective(image_np, matrix, (self.target_w, self.target_h))
            return warped, True

        return None, False

    def _align_document_contour(self, image_np):
        gray = cv2.cvtColor(image_np, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        edged = cv2.Canny(blurred, 50, 150)

        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
        closed = cv2.morphologyEx(edged, cv2.MORPH_CLOSE, kernel)

        contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        contours = sorted(contours, key=cv2.contourArea, reverse=True)[:5]

        for cnt in contours:
            peri = cv2.arcLength(cnt, True)
            approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)
            area = cv2.contourArea(cnt)
            if len(approx) == 4 and area > (image_np.shape[0] * image_np.shape[1] * 0.20):
                pts = approx.reshape(4, 2)
                # Сортировка 4 точек
                rect = np.zeros((4, 2), dtype="float32")
                s = pts.sum(axis=1)
                rect[0] = pts[np.argmin(s)]
                rect[2] = pts[np.argmax(s)]
                diff = np.diff(pts, axis=1)
                rect[1] = pts[np.argmin(diff)]
                rect[3] = pts[np.argmax(diff)]

                dst = np.float32([
                    [0, 0],
                    [self.target_w - 1, 0],
                    [self.target_w - 1, self.target_h - 1],
                    [0, self.target_h - 1]
                ])
                matrix = cv2.getPerspectiveTransform(rect, dst)
                warped = cv2.warpPerspective(image_np, matrix, (self.target_w, self.target_h))
                return warped, True

        return None, False

    def align(self, image_np):
        # 1. ArUco
        warped, ok = self._align_aruco(image_np)
        if ok:
            return warped, True

        # 2. Черные угловые реперные метки
        warped, ok = self._align_black_squares(image_np)
        if ok:
            return warped, True

        # 3. Контур бумаги
        warped, ok = self._align_document_contour(image_np)
        if ok:
            return warped, True

        # Fallback: прямой ресайз
        resized = cv2.resize(image_np, (self.target_w, self.target_h))
        return resized, False
