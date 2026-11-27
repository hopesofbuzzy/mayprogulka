# -*- coding: utf-8 -*-
"""Деградации синтетических бланков для приближения к реальным фото со смартфона."""
import random
import cv2
import numpy as np


def _rotation(img, angle):
    h, w = img.shape[:2]
    M = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    cos, sin = abs(M[0, 0]), abs(M[0, 1])
    nW, nH = int(h * sin + w * cos), int(h * cos + w * sin)
    M[0, 2] += nW / 2 - w / 2
    M[1, 2] += nH / 2 - h / 2
    return cv2.warpAffine(img, M, (nW, nH), borderValue=(255, 255, 255))


def _perspective(img, strength):
    h, w = img.shape[:2]
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    dst = np.float32([
        [w * strength * np.random.rand(), h * strength * np.random.rand()],
        [w - w * strength * np.random.rand(), h * strength * np.random.rand()],
        [w - w * strength * np.random.rand(), h - h * strength * np.random.rand()],
        [w * strength * np.random.rand(), h - h * strength * np.random.rand()],
    ])
    M = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(img, M, (w, h), borderValue=(255, 255, 255))


def _lighting(img, gamma, shadow_strength):
    """Гамма + градиентная тень сверху, как у фото при вечернем освещении."""
    lut = np.array([((i / 255.0) ** gamma) * 255 for i in range(256)]).astype("uint8")
    out = cv2.LUT(img, lut)
    h, w = out.shape[:2]
    grad = np.linspace(1.0 - shadow_strength, 1.0, h).reshape(h, 1, 1)
    out = np.clip(out.astype(np.float32) * grad, 0, 255).astype(np.uint8)
    return out


def _noise(img, sigma):
    g = np.random.normal(0, sigma, img.shape).astype(np.float32)
    return np.clip(img.astype(np.float32) + g, 0, 255).astype(np.uint8)


def _jpeg(img, quality):
    ok, enc = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    return cv2.imdecode(enc, cv2.IMREAD_COLOR) if ok else img


SEVERITY = {
    # уровень: (rot, persp, gamma_range, shadow, noise_sigma, blur, jpeg_q, long_side)
    "mild":   dict(rot=1.5, persp=0.004, gamma=(0.92, 1.08), shadow=0.10, sigma=3, blur=0, jpeg=85, side=2400),
    "medium": dict(rot=3.0, persp=0.010, gamma=(0.75, 1.25), shadow=0.22, sigma=6, blur=3, jpeg=70, side=2000),
    "hard":   dict(rot=5.0, persp=0.020, gamma=(0.60, 1.45), shadow=0.35, sigma=10, blur=5, jpeg=55, side=1600),
}


def degrade(img, severity, rng):
    """Применяет цепочку деградаций, имитирующих фото со смартфона."""
    p = SEVERITY[severity]
    out = img
    if p["side"] < max(out.shape[:2]):
        scale = p["side"] / max(out.shape[:2])
        out = cv2.resize(out, (int(out.shape[1] * scale), int(out.shape[0] * scale)), interpolation=cv2.INTER_AREA)
    out = _rotation(out, rng.uniform(-p["rot"], p["rot"]))
    out = _perspective(out, p["persp"] * (0.5 + rng.random()))
    out = _lighting(out, rng.uniform(*p["gamma"]), p["shadow"] * (0.6 + 0.4 * rng.random()))
    if p["blur"]:
        out = cv2.GaussianBlur(out, (p["blur"], p["blur"]), 0)
    out = _noise(out, p["sigma"] * (0.5 + rng.random()))
    out = _jpeg(out, rng.randint(p["jpeg"] - 8, p["jpeg"]))
    return out
