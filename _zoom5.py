from PIL import Image
ROOT = r"C:\Users\admin\WorkBuddy\2026-09-21-17-41-08\portfolio"

im = Image.open(ROOT + r"\_rest.png").convert("RGB")

def scan(label, y, x0, x1, step=12):
    print(label)
    for px in range(x0, x1, step):
        print("   x=%4d %s" % (px, im.getpixel((px, y))))

# teal torus, left edge of frame, sitting on plain dark background
scan("teal torus glow decay (y=556, outward to the left):", 556, 40, 200)
# aqua star, left cluster, on dark background
scan("aqua star glow decay (y=696, outward to the left):", 696, 300, 440)
# empty dark corner — the baseline background
scan("baseline background (y=760, right side):", 760, 1300, 1520, 40)
