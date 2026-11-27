import cv2
import numpy as np

class DocumentAligner:
    """Align the v3 form using its four ArUco markers."""
    def __init__(self, target_w=1200, target_h=1600):
        self.target_w = target_w
        self.target_h = target_h
        self.aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
        self.detector = cv2.aruco.ArucoDetector(self.aruco_dict)

        self.dst_centers = {
            0: [54.5, 54.5],
            1: [float(self.target_w - 55.5), 54.5],
            2: [float(self.target_w - 55.5), float(self.target_h - 55.5)],
            3: [54.5, float(self.target_h - 55.5)]
        }

    def _align_aruco(self, image_np):
        gray = cv2.cvtColor(image_np, cv2.COLOR_BGR2GRAY)
        corners, ids, _ = self.detector.detectMarkers(gray)

        if ids is not None and len(ids) == 4:
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
