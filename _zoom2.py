from PIL import Image
ROOT = r"C:\Users\admin\WorkBuddy\2026-09-21-17-41-08\portfolio"
for name in ("_solo", "_sweep"):
    im = Image.open(ROOT + "\\" + name + ".png").convert("RGB")
    x, y, w, h = 1180, 130, 380, 260
    im.crop((x, y, x + w, y + h)).resize((w * 3, h * 3), Image.NEAREST).save(ROOT + "\\" + name + "_zoom.png")
im = Image.open(ROOT + r"\_solo.png").convert("RGB")
print("solo head row y=240:")
for px in range(1300, 1400, 8):
    print("  x=%d %s" % (px, im.getpixel((px, 240))))
print("solo along the trail y=380:")
for px in range(900, 1100, 20):
    print("  x=%d %s" % (px, im.getpixel((px, 380))))
