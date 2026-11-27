import cv2
import numpy as np


class DocumentAligner:
    """
    Выравнивание перспективы бланка анкеты к единому формату 1200x1600:
    1. ArUco-маркеры (0=TL, 1=TR, 2=BR, 3=BL) — новый машиночитаемый бланк (поддержка 3 из 4 и пересветов).
    2. 4 угловых чёрных реперных квадрата — классический бланк (масштабируется под любое разрешение фото).
    3. Внешний контур листа бумаги (CamScanner-подход).
    """

    def __init__(self, target_w=1200, target_h=1600):
        self.target_w = target_w
        self.target_h = target_h
        self.aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
        self.detector = cv2.aruco.ArucoDetector(self.aruco_dict)

        relaxed_params = cv2.aruco.DetectorParameters()
        relaxed_params.adaptiveThreshWinSizeMin = 3
        relaxed_params.adaptiveThreshWinSizeMax = 53
        relaxed_params.adaptiveThreshWinSizeStep = 4
        relaxed_params.minMarkerPerimeterRate = 0.015
        relaxed_params.polygonalApproxAccuracyRate = 0.06
        relaxed_params.errorCorrectionRate = 0.8
        self.relaxed_detector = cv2.aruco.ArucoDetector(self.aruco_dict, relaxed_params)

        # Точные центры ArUco-маркеров в FormGenerator (marker_size=70 -> half=34.5)
        self.aruco_centers = {
            0: [54.5, 54.5],
            1: [float(self.target_w - 55.5), 54.5],
            2: [float(self.target_w - 55.5), float(self.target_h - 55.5)],
            3: [54.5, float(self.target_h - 55.5)],
        }
        self.aruco_half = 34.5

        # Центры чёрных угловых квадратов на классическом бланке
        self.dst_centers = {
            0: [50.0, 50.0],
            1: [float(self.target_w - 50), 50.0],
            2: [float(self.target_w - 50), float(self.target_h - 50)],
            3: [50.0, float(self.target_h - 50)],
        }

    def _collect_aruco_markers(self, gray):
        id_map = {}

        def _merge(detector, img_g):
            corners, ids, _ = detector.detectMarkers(img_g)
            if ids is None:
                return
            for i in range(len(ids)):
                mid = int(ids[i][0]) if hasattr(ids[i], "__len__") else int(ids[i])
                if mid in (0, 1, 2, 3) and mid not in id_map:
                    id_map[mid] = corners[i][0]

        _merge(self.detector, gray)
        if len(id_map) < 4:
            _merge(self.relaxed_detector, gray)
        if len(id_map) < 4:
            clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(gray)
            _merge(self.relaxed_detector, clahe)
        if len(id_map) < 4:
            # Гамма-коррекция помогает на сильно засвеченных сканах
            gamma = np.clip((gray.astype(np.float32) / 255.0) ** 2.0 * 255.0, 0, 255).astype(np.uint8)
            _merge(self.relaxed_detector, gamma)

        return id_map

    def _align_aruco(self, image_np):
        gray = cv2.cvtColor(image_np, cv2.COLOR_BGR2GRAY)
        id_map = self._collect_aruco_markers(gray)

        if all(k in id_map for k in (0, 1, 2, 3)):
            src_pts = []
            dst_pts = []
            for k in (0, 1, 2, 3):
                marker_corners = id_map[k]
                cx = float(np.mean(marker_corners[:, 0]))
                cy = float(np.mean(marker_corners[:, 1]))
                src_pts.append([cx, cy])
                dst_pts.append(self.aruco_centers[k])

            matrix = cv2.getPerspectiveTransform(
                np.float32(src_pts), np.float32(dst_pts)
            )
            warped = cv2.warpPerspective(
                image_np, matrix, (self.target_w, self.target_h)
            )
            return warped, True

        # Резерв: если видны 3 из 4 угловых ArUco-маркеров, 12 угловых точек дают точную гомографию
        if len(id_map) == 3:
            src_pts = []
            dst_pts = []
            h = self.aruco_half
            for k in sorted(id_map.keys()):
                mc = id_map[k]
                if len(mc) != 4:
                    continue
                cx, cy = self.aruco_centers[k]
                dst_corners = [
                    [cx - h, cy - h],
                    [cx + h, cy - h],
                    [cx + h, cy + h],
                    [cx - h, cy + h],
                ]
                for pt_s, pt_d in zip(mc, dst_corners):
                    src_pts.append([float(pt_s[0]), float(pt_s[1])])
                    dst_pts.append(pt_d)
            if len(src_pts) >= 12:
                matrix, _ = cv2.findHomography(np.float32(src_pts), np.float32(dst_pts))
                if matrix is not None:
                    warped = cv2.warpPerspective(
                        image_np, matrix, (self.target_w, self.target_h)
                    )
                    return warped, True

        return None, False

    def _find_squares_in_quadrants(self, gray, thresh_val):
        h, w = gray.shape
        img_area = float(h * w)
        min_area = max(80.0, img_area * 0.00012)
        max_area = max(6000.0, img_area * 0.012)

        _, thresh = cv2.threshold(gray, thresh_val, 255, cv2.THRESH_BINARY_INV)
        contours, _ = cv2.findContours(
            thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )

        # Реперные квадраты находятся в угловых зонах бланка (внешние 35% по краям)
        quadrants = {
            "TL": (0, 0, int(w * 0.35), int(h * 0.35)),
            "TR": (int(w * 0.65), 0, w, int(h * 0.35)),
            "BR": (int(w * 0.65), int(h * 0.65), w, h),
            "BL": (0, int(h * 0.65), int(w * 0.35), h),
        }

        detected = {}
        for q_name, (qx1, qy1, qx2, qy2) in quadrants.items():
            best_score = 0.0
            best_pt = None
            for cnt in contours:
                area = cv2.contourArea(cnt)
                if not (min_area < area < max_area):
                    continue
                x, y, bw, bh = cv2.boundingRect(cnt)
                if bw <= 0 or bh <= 0:
                    continue
                aspect = float(bw) / bh
                solidity = area / float(bw * bh)
                if not (0.65 <= aspect <= 1.45 and solidity >= 0.72):
                    continue
                # Отсеиваем маркеры со светлыми внутренними ячейками (остаются только сплошные чёрные квадраты)
                px1, py1 = x + max(1, bw // 5), y + max(1, bh // 5)
                px2, py2 = x + bw - max(1, bw // 5), y + bh - max(1, bh // 5)
                inner_fill = float((thresh[py1:py2, px1:px2] > 0).mean()) if (px2 > px1 and py2 > py1) else 0.0
                if inner_fill < 0.72:
                    continue
                M = cv2.moments(cnt)
                if M["m00"] == 0:
                    continue
                cx = int(M["m10"] / M["m00"])
                cy = int(M["m01"] / M["m00"])
                if qx1 <= cx <= qx2 and qy1 <= cy <= qy2:
                    score = area * solidity
                    if score > best_score:
                        best_score = score
                        best_pt = (cx, cy)
            detected[q_name] = best_pt

        return detected

    def _align_black_squares(self, image_np):
        """
        Детекция 4 черных угловых меток-квадратов (для классического бланка)
        с адаптацией под разное разрешение и освещение.
        """
        gray = cv2.cvtColor(image_np, cv2.COLOR_BGR2GRAY)
        clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8)).apply(gray)

        candidates = [
            (gray, 95),
            (gray, 120),
            (gray, 75),
            (gray, 145),
            (clahe, 95),
            (clahe, 120),
        ]

        for img_g, thresh_val in candidates:
            detected = self._find_squares_in_quadrants(img_g, thresh_val)
            if all(detected[k] is not None for k in ["TL", "TR", "BR", "BL"]):
                src_pts = np.float32(
                    [detected["TL"], detected["TR"], detected["BR"], detected["BL"]]
                )
                dst_pts = np.float32(
                    [
                        [50, 50],
                        [self.target_w - 50, 50],
                        [self.target_w - 50, self.target_h - 50],
                        [50, self.target_h - 50],
                    ]
                )
                matrix = cv2.getPerspectiveTransform(src_pts, dst_pts)
                warped = cv2.warpPerspective(
                    image_np, matrix, (self.target_w, self.target_h)
                )
                return warped, True

        return None, False

    def _align_document_contour(self, image_np):
        h, w = image_np.shape[:2]
        scale = 1.0
        work = image_np
        if max(h, w) > 1800:
            scale = 1600.0 / max(h, w)
            work = cv2.resize(
                image_np, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA
            )

        gray = cv2.cvtColor(work, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        edged = cv2.Canny(blurred, 50, 150)

        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
        closed = cv2.morphologyEx(edged, cv2.MORPH_CLOSE, kernel)

        contours, _ = cv2.findContours(
            closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )
        contours = sorted(contours, key=cv2.contourArea, reverse=True)[:5]

        work_area = work.shape[0] * work.shape[1]
        for cnt in contours:
            peri = cv2.arcLength(cnt, True)
            approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)
            area = cv2.contourArea(cnt)
            if len(approx) == 4 and area > (work_area * 0.20):
                pts = approx.reshape(4, 2).astype("float32") / scale
                rect = np.zeros((4, 2), dtype="float32")
                s = pts.sum(axis=1)
                rect[0] = pts[np.argmin(s)]
                rect[2] = pts[np.argmax(s)]
                diff = np.diff(pts, axis=1)
                rect[1] = pts[np.argmin(diff)]
                rect[3] = pts[np.argmax(diff)]

                dst = np.float32(
                    [
                        [0, 0],
                        [self.target_w - 1, 0],
                        [self.target_w - 1, self.target_h - 1],
                        [0, self.target_h - 1],
                    ]
                )
                matrix = cv2.getPerspectiveTransform(rect, dst)
                warped = cv2.warpPerspective(
                    image_np, matrix, (self.target_w, self.target_h)
                )
                return warped, True

        return None, False

    def align(self, image_np):
        warped, ok = self._align_aruco(image_np)
        if ok:
            return warped, True

        warped, ok = self._align_black_squares(image_np)
        if ok:
            return warped, True

        warped, ok = self._align_document_contour(image_np)
        if ok:
            return warped, True

        resized = cv2.resize(image_np, (self.target_w, self.target_h))
        return resized, False
