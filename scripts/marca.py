# Genera los assets de marca Grupo Gestion desde el logo subido (jpeg).
# Salidas: public/logo.png (transparente), public/logo-icon.png (solo flechas),
# src/app/icon.png (favicon 512), src/app/apple-icon.png (180) + paleta de colores.
from PIL import Image
import os

SRC = "/home/z/my-project/upload/images (2).jpeg"
PUB = "/home/z/my-project/public"
APP = "/home/z/my-project/src/app"

img = Image.open(SRC).convert("RGBA")
print("origen:", img.size)

# 1) blanco -> transparente (tolerancia suave para JPEG)
px = img.load()
w, h = img.size
def blanco(r, g, b, a):
    return r > 242 and g > 242 and b > 242
for y in range(h):
    for x in range(w):
        r, g, b, a = px[x, y]
        if blanco(r, g, b, a):
            px[x, y] = (r, g, b, 0)

# 2) bounding box de pixeles no transparentes
bbox = img.getbbox()  # (l, t, r, b) de pixeles != 0
print("bbox total:", bbox)
logo = img.crop(bbox)

# 3) recorte de solo las flechas: columna donde empieza el texto "GRUPO"
#    (buscamos el gran hueco vertical de contenido en la mitad derecha)
l, t, r, b = bbox
col_has = []
for x in range(l, r):
    hay = False
    for y in range(t, b, 2):
        if px[x, y][3] > 0:
            hay = True
            break
    col_has.append(hay)
# hueco = corrida de >= 8 columnas vacias en el 50-85% del ancho
hueco_ini = None
for i in range(int(len(col_has) * 0.45), int(len(col_has) * 0.85) - 8):
    if not any(col_has[i:i + 8]):
        hueco_ini = i
        break
corte = (l + hueco_ini) if hueco_ini is not None else (l + int((r - l) * 0.55))

# recorte robusto: las flechas contienen los pixeles SATURADOS (verde/naranja);
# el texto y sus bordes son grises. El borde derecho de lo saturado = borde de las flechas.
minx, maxx = w, 0
for y in range(t, b):
    for x in range(l, r):
        r0, g0, b0, a0 = px[x, y]
        if a0 > 0 and (max(r0, g0, b0) - min(r0, g0, b0)) > 40:
            minx = min(minx, x); maxx = max(maxx, x)
if maxx > minx:
    corte = maxx + int((maxx - minx) * 0.05)
    print("corte por saturacion: x =", corte)
flechas = img.crop((l, t, corte, b))
fb = flechas.getbbox()
flechas = flechas.crop(fb)
print("flechas:", flechas.size)

def cuadrado(im, lado, fondo=(255, 255, 255, 0)):
    s = max(im.size)
    canvas = Image.new("RGBA", (s, s), fondo)
    canvas.paste(im, ((s - im.width) // 2, (s - im.height) // 2), im)
    return canvas.resize((lado, lado), Image.LANCZOS)

# 4) exportar
logo_full = logo.copy()
ratio = 720 / logo_full.width
logo_full = logo_full.resize((720, int(logo_full.height * ratio)), Image.LANCZOS)
logo_full.save(f"{PUB}/logo.png")

cuadrado(flechas, 256).save(f"{PUB}/logo-icon.png")
cuadrado(flechas, 512).save(f"{APP}/icon.png")
cuadrado(flechas, 180).save(f"{APP}/apple-icon.png")
print("guardados logo.png / logo-icon.png / icon.png / apple-icon.png")

# 5) paleta: colores dominantes de las flechas (saturados)
from collections import Counter
c = Counter()
for y in range(0, flechas.height, 2):
    for x in range(0, flechas.width, 2):
        r, g, b, a = flechas.getpixel((x, y))
        if a > 200 and (max(r, g, b) - min(r, g, b)) > 40:  # saturado
            c[(r // 16 * 16, g // 16 * 16, b // 16 * 16)] += 1
for (r, g, b), n in c.most_common(12):
    print(f"#{r:02x}{g:02x}{b:02x}  x{n}")
