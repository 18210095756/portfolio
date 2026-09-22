from PIL import Image
ROOT = r"C:\Users\admin\WorkBuddy\2026-09-21-17-41-08\portfolio"

# idle: the cursor is parked at (1180,300) — crop the lens region of the headline
im = Image.open(ROOT + r"\_idle.png").convert("RGB")
x, y, w, h = 900, 150, 560, 320
im.crop((x, y, x + w, y + h)).resize((int(w * 1.9), int(h * 1.9)), Image.LANCZOS).save(ROOT + r"\_idle_zoom.png")
print("idle crop ok")
