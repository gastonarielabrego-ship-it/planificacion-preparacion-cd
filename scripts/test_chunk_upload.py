#!/usr/bin/env python3
"""Prueba end-to-end de la subida por chunks contra /api/upload.
Uso: python test_chunk_upload.py <archivo.xlsx> <tipo> [url] [tam_parte_kb]"""
import base64
import json
import sys
import time
import urllib.request
import uuid

ARCHIVO = sys.argv[1] if len(sys.argv) > 1 else "/home/z/my-project/tmp/H61_GRANDE_TEST.xlsx"
TIPO = sys.argv[2] if len(sys.argv) > 2 else "h61"
BASE = sys.argv[3] if len(sys.argv) > 3 else "http://localhost:3000"
TAM_PARTE = int(sys.argv[4]) * 1024 if len(sys.argv) > 4 else 2 * 1024 * 1024

def post(body, timeout=1800):
    req = urllib.request.Request(f"{BASE}/api/upload", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")

raw = open(ARCHIVO, "rb").read()
total = max(1, (len(raw) + TAM_PARTE - 1) // TAM_PARTE)
file_id = f"test-{int(time.time())}-{uuid.uuid4().hex[:6]}"
print(f"archivo={ARCHIVO} ({len(raw)/1024/1024:.2f} MB) tipo={TIPO} partes={total} base={BASE}")

t0 = time.time()
res_final = None
for i in range(total):
    parte = raw[i * TAM_PARTE:(i + 1) * TAM_PARTE]
    data = base64.b64encode(parte).decode()
    t1 = time.time()
    status, j = post({"modo": "chunk", "tipo": TIPO, "fileId": file_id, "nombre": ARCHIVO.split("/")[-1], "i": i, "total": total, "data": data})
    print(f"  parte {i+1}/{total} ({len(data)/1024:.0f} KB b64) -> HTTP {status} {json.dumps(j, ensure_ascii=False)[:180]} [{time.time()-t1:.1f}s]")
    if status != 200:
        print(f"  [FALLO] HTTP {status}"); sys.exit(1)
    res_final = j

print(f"total: {time.time()-t0:.1f}s")
assert res_final is not None and res_final.get("ok") is True, f"respuesta final invalida: {res_final}"
assert res_final.get("fase") == "procesado" or "insertados" in res_final, f"no se proceso: {res_final}"
print(f"[OK] procesado: insertados={res_final.get('insertados'):,} errores={res_final.get('errores')} desde={res_final.get('desde')} hasta={res_final.get('hasta')}")

# verificacion: estado de datos + limpieza de chunks
with urllib.request.urlopen(f"{BASE}/api/status", timeout=60) as r:
    st = json.loads(r.read().decode())
print(f"status h61: {st['h61']['registros']:,} filas ({st['h61']['desde'][:10]} -> {st['h61']['hasta'][:10]})")
print("[OK] test chunk completo")
