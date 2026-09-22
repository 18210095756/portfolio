from PIL import Image
ROOT = r"C:\Users\admin\WorkBuddy\2026-09-21-17-41-08\portfolio"

im = Image.open(ROOT + r"\_rest.png").convert("RGB")
print("image", im.size)

# the cube
x, y, w, h = 570, 205, 490, 510
im.crop((x, y, x + w, y + h)).resize((int(w * 1.7), int(h * 1.7)), Image.LANCZOS).save(ROOT + r"\_z_cube.png")

# a macaron shape + its halo, over the dark background
x, y, w, h = 1000, 290, 320, 280
im.crop((x, y, x + w, y + h)).resize((int(w * 2.4), int(h * 2.4)), Image.LANCZOS).save(ROOT + r"\_z_shape.png")

# sample a horizontal line out through a shape to see how the glow decays
print("halo decay, y=380 through the pink gem at x~1126:")
for px in range(1120, 1330, 14):
    print("  x=%d %s" % (px, im.getpixel((px, 380))))
