"""Procedural studio backdrop for the opening demo (public/demo/stage.jpg).

Deep charcoal/navy base, a large soft violet glow upper right and a faint warm
amber glow lower left, plus fine grain. No AI model involved.
Usage: python stage_bg.py <out.jpg>
"""
import sys
import numpy as np
from PIL import Image

W, H = 1920, 1088
y, x = np.mgrid[0:H, 0:W].astype(np.float32)
u, v = x / W, y / H


def glow(cx, cy, rx, ry, power=1.0):
    d = ((u - cx) / rx) ** 2 + ((v - cy) / ry) ** 2
    return np.exp(-d * 2.2) ** power


vign = np.clip(1 - 0.9 * (np.maximum(0, u - 0.82) / 0.18) ** 2 - 0.6 * (np.maximum(0, v - 0.8) / 0.2) ** 2 * u, 0.25, 1)
base = np.stack([3 + 24 * v * (1 - 0.5 * u), 2 + 21 * v * (1 - 0.3 * u), 7 + 44 * v * (1 - 0.2 * u) + 22 * u * (1 - v)], -1) * vign[..., None]
violet = glow(0.80, 0.15, 0.17, 0.27)[..., None] * np.array([150, 88, 205])
halo = glow(0.74, 0.32, 0.36, 0.55)[..., None] * np.array([26, 20, 62]) * vign[..., None]
am = glow(0.13, 0.88, 0.20, 0.26)[..., None]
amber = am * np.array([66, 46, 6])
base = base * (1 - am * np.array([0.2, 0.3, 0.75]))
img = base + halo + violet + amber
rng = np.random.default_rng(7)
img += rng.normal(0, 1.6, img.shape)
Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(sys.argv[1], quality=90)
