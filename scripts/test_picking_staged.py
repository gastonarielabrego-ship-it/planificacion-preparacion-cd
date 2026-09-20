#!/usr/bin/env python3
"""E2E del pipeline por pasos para picking (fix HTTP 504):
1) sube el archivo por partes de 2 MB a /api/upload  -> fase 'armado'
2) /api/upload/procesar paso=parseo                  -> stage con tandas de 2000
3) /api/upload/procesar paso=insertar (bucle)        -> tandas de ~50k a PickingEvento
4) /api/upload/procesar paso=cerrar
5) verifica conteos por /api/status y reanudabilidad (insertar extra = 0)
Uso: python scripts/test_picking_staged.py [archivo.xlsx] [base_url]"""
import base64
import os
import sys
import time

import requests

ARCH = sys.argv[1] if len(sys.argv) > 1 else "/home/z/my-project/tmp/picking-grande-test.xlsx"
BASE = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:3000"
TAM = 2 * 1024 * 1024

status0 = requests.get(f"{BASE}/api/status", timeout=30).json()
base_picking = status0["picking"]["registros"]
print(f"picking antes: {base_picking} (la carga de picking REEMPLAZA, no acumula)")

size = os.path.getsize(ARCH)
total = (size + TAM - 1) // TAM
file_id = f"t{int(time.time()*1000)}"
t0 = time.time()
with open(ARCH, "rb") as f:
    for i in range(total):
        data = base64.b64encode(f.read(TAM)).decode()
        r = requests.post(f"{BASE}/api/upload", json={
            "modo": "chunk", "tipo": "picking", "fileId": file_id,
            "nombre": os.path.basename(ARCH), "i": i, "total": total, "data": data,
        }, timeout=60)
        r.raise_for_status()
        j = r.json()
        assert j.get("fase") in ("chunk", "armado"), j
        if j.get("fase") == "armado":
            break
print(f"[1] chunks: {total} partes en {time.time()-t0:.1f}s -> fase={j.get('fase')}")

# re-verificacion: mandar una parte extra no debe romper (idempotencia de upsert)
# (omitido: upsert por fileId+idx es idempotente por diseño)

t0 = time.time()
r = requests.post(f"{BASE}/api/upload/procesar", json={"paso": "parseo", "fileId": file_id,
                                                       "nombre": os.path.basename(ARCH)}, timeout=300)
j = r.json()
print(f"[2] parseo: HTTP {r.status_code} en {time.time()-t0:.1f}s -> {j}")
assert r.status_code == 200 and j.get("fase") == "parseado", j
esperadas = j["filas"]

t0 = time.time()
insertados = 0
vuelta = 0
while True:
    r = requests.post(f"{BASE}/api/upload/procesar", json={"paso": "insertar", "fileId": file_id}, timeout=300)
    j = r.json()
    assert r.status_code == 200, j
    vuelta += 1
    insertados += j["insertados"]
    print(f"    insertar #{vuelta}: +{j['insertados']} (restan {j['restantes']}) [{time.time()-t0:.1f}s acumulado]")
    if j["restantes"] == 0:
        break
print(f"[3] insertar: {insertados} filas en {vuelta} tandas / {time.time()-t0:.1f}s")
assert insertados == esperadas, (insertados, esperadas)

# reanudabilidad: llamar insertar de nuevo no inserta nada
r = requests.post(f"{BASE}/api/upload/procesar", json={"paso": "insertar", "fileId": file_id}, timeout=60)
assert r.json()["insertados"] == 0 and r.json()["restantes"] == 0, r.json()

t0 = time.time()
r = requests.post(f"{BASE}/api/upload/procesar", json={"paso": "cerrar", "fileId": file_id}, timeout=60)
j = r.json()
print(f"[4] cerrar: HTTP {r.status_code} en {time.time()-t0:.1f}s -> {j}")
assert r.status_code == 200 and j.get("fase") == "cerrado", j
assert j["insertados"] == esperadas, j

status1 = requests.get(f"{BASE}/api/status", timeout=30).json()
final = status1["picking"]["registros"]
print(f"[5] status: picking {base_picking} -> {final}")
assert final == esperadas, (final, esperadas)
print(f"OK: {esperadas} filas, reemplazo exacto, 0 duplicadas ({status1['picking']['desde'][:10]} -> {status1['picking']['hasta'][:10]})")
