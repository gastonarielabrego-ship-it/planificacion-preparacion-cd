#!/usr/bin/env python3
"""Prepara el logo de Grupo Gestion: recorta, genera PNG header, favicon, apple-icon y logo.ts (base64)."""
from PIL import Image
import base64, os

SRC = "/home/z/my-project/upload/images (2).jpeg"
PUB = "/home/z/my-project/public"
APP = "/home/z/my-project/src/app"
LIB = "/home/z/my-project/src/lib"

os.makedirs(PUB, exist_ok=True)

img = Image.open(SRC).convert("RGB")
print("origen:", img.size)

# Recorte automatico del fondo blanco (deja margen 4%)
from PIL import ImageChops
bg = Image.new("RGB", img.size, (255, 255, 255))
diff = ImageChops.difference(img, bg)
bbox = diff.getbbox()
if bbox:
    pad = 6
    l = max(0, bbox[0] - pad); t = max(0, bbox[1] - pad)
    r = min(img.width, bbox[2] + pad); b = min(img.height, bbox[3] + pad)
    img = img.crop((l, t, r, b))
print("recortado:", img.size)

def escalar_a_ancho(im, ancho):
    alto = round(im.height * ancho / im.width)
    return im.resize((ancho, alto), Image.LANCZOS)

# 1) logo header (png blanco, 520px de ancho -> se muestra ~160-200px)
logo_header = escalar_a_ancho(img, 520)
logo_header.save(f"{PUB}/logo-grupo-gestion.png", "PNG", optimize=True)

# 2) favicon cuadrado 512: logo centrado sobre blanco con margen
def icono_cuadrado(px):
    escala = escalar_a_ancho(img, px)
    lado = int(px * 1.12)
    canvas = Image.new("RGB", (lado, lado), (255, 255, 255))
    canvas.paste(escala, ((lado - escala.width) // 2, (lado - escala.height) // 2))
    return canvas

icono_cuadrado(512).save(f"{APP}/icon.png", "PNG", optimize=True)
icono_cuadrado(180).save(f"{APP}/apple-icon.png", "PNG", optimize=True)

# 3) logo.ts con base64 (para el informe Excel server-side, lectura desde /public)
with open(f"{PUB}/logo-grupo-gestion.png", "rb") as f:
    b64 = base64.b64encode(f.read()).decode()
with open(f"{LIB}/logo.ts", "w") as f:
    f.write("// Logo institucional de Grupo Gestion (PNG en base64) para el informe Excel.\n")
    f.write("// Generado desde public/logo-grupo-gestion.png\n")
    f.write(f'export const LOGO_BASE64 = "{b64}"\n')
    f.write('export const LOGO_MIME = "image/png"\n')

print("OK: public/logo-grupo-gestion.png, icon.png, apple-icon.png, src/lib/logo.ts")
print("tamano header:", os.path.getsize(f"{PUB}/logo-grupo-gestion.png"), "bytes")
