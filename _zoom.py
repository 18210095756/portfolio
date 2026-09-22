"""Scaffolding: crop + magnify the comet head so the banding is visible."""
from PIL import Image

ROOT = r"C:\Users\admin\WorkBuddy\2026-09-21-17-41-08\portfolio"
src = Image.open(ROOT + r"\_sweep.png").convert("RGB")

x, y, w, h = 1180, 120, 420, 300
crop = src.crop((x, y, x + w, y + h))
crop.resize((w * 3, h * 3), Image.NEAREST).save(ROOT + r"\_zoom.png")

# scan a horizontal line straight through the head glow
print("scan y=240 (through the cursor x):")
for px in range(1280, 1420, 6):
    print("  x=%d  %s" % (px, src.getpixel((px, 240))))

print("scan through the core of the blob y=215:")
for px in range(1280, 1420, 6):
    print("  x=%d  %s" % (px, src.getpixel((px, 215))))
