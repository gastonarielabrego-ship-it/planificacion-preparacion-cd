#!/usr/bin/env python3
"""Test E2E: sube el picking real por chunks (misma via que la web) y valida /api/data?modulo=picking."""
import base64, json, math, sys, urllib.request

BASE = "http://localhost:3000"
ARCHIVO = "/home/z/my-project/scripts/test_cargas/produccion picking 2026.xlsx"
TAM = 2 * 1024 * 1024

def post(ruta, payload):
    req = urllib.request.Request(
        f"{BASE}{ruta}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.status, json.loads(r.read().decode())

with open(ARCHIVO, "rb") as f:
    raw = f.read()
total = max(1, math.ceil(len(raw) / TAM))
file_id = f"e8-test-{int(__import__('time').time())}"
print(f"Archivo: {len(raw):,} bytes -> {total} partes")

last = {}
for i in range(total):
    parte = base64.b64encode(raw[i * TAM:(i + 1) * TAM]).decode()
    st, j = post("/api/upload", {"modo": "chunk", "tipo": "picking", "fileId": file_id,
                                 "nombre": "produccion picking 2026.xlsx", "i": i, "total": total, "data": parte})
    last = j
    if "fase" in j:
        print(f"  parte {i+1}/{total}: {j['recibidos']}/{j['total']}")
print("Final:", json.dumps(last, ensure_ascii=False)[:300])
if not last.get("ok"):
    sys.exit(f"FALLO la subida: {last}")

# validar agregacion
req = urllib.request.urlopen(f"{BASE}/api/data?modulo=picking", timeout=120)
d = json.loads(req.read().decode())
print("\n== /api/data?modulo=picking ==")
print("registros:", d.get("registros"), "| periodo:", d.get("desde"), "->", d.get("hasta"), "| meses:", d.get("meses"))
print("fuentes:", json.dumps(d.get("fuentes"), ensure_ascii=False))
print("gapProm:", d.get("gapPromedio"), "| gapMediana:", d.get("gapMediana"))
print("bultos:", d.get("bultos"), "| operarios:", d.get("operarios"), "| zonas:", len(d.get("porZona") or []))
print("porActividad:", len(d.get("porActividad") or []), "| recorridos:", len(d.get("recorridosTop") or []),
      "| paresZona:", len(d.get("paresZona") or []))
print("productividad:", json.dumps(d.get("productividad")))
print("topColaborador:", json.dumps(d.get("topColaborador"), ensure_ascii=False)[:160])

# prodcirc ya no debe existir
try:
    urllib.request.urlopen(f"{BASE}/api/data?modulo=prodcirc", timeout=30)
    print("\n[ERROR] modulo=prodcirc sigue respondiendo 200")
except Exception as e:
    print("\n[OK] modulo=prodcirc rechazado:", e)
