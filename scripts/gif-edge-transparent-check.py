#!/usr/bin/env python3
"""ponytail: assert edge-flood GIF keeps interior white fur opaque."""
from PIL import Image

PATH = "assets/loading-dancing-cat.gif"
THRESH = 240

im = Image.open(PATH)
im.seek(0)
px = im.convert("RGBA").load()
w, h = im.size
assert px[0, 0][3] == 0, "border must be transparent"
iw = sum(
    1
    for y in range(80, h - 80)
    for x in range(80, w - 80)
    if (p := px[x, y])[3] > 200 and p[0] > THRESH and p[1] > THRESH and p[2] > THRESH
)
# bad global punch left ~500; flood-fill keeps ~10k
assert iw > 2000, f"interior white fur missing: {iw}"
print(f"ok: border transparent, interior_white={iw}")
