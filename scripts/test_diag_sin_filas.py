#!/usr/bin/env python3
"""E2E de los casos 'sin filas legibles' contra el sandbox.
Uso: python3 test_diag_sin_filas.py [url]"""
import base64, json, sys, time, urllib.request, urllib.error, uuid

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"
timeout_procesar = 280

def post(body, timeout=300):
    req = urllib.request.Request(f"{BASE}/api/upload", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except Exception:
            return e.code, {}

def get(url, timeout=120):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except Exception:
            return e.code, {}

def subir_chunks(archivo, tipo):
    raw = open(archivo, "rb").read()
    tam = 2 * 1024 * 1024
    total = max(1, (len(raw) + tam - 1) // tam)
    fid = f"diagtest-{int(time.time())}-{uuid.uuid4().hex[:6]}"
    resp = None
    for i in range(total):
        parte = raw[i*tam:(i+1)*tam]
        st, j = post({"modo": "chunk", "tipo": tipo, "fileId": fid, "nombre": archivo.split("/")[-1],
                      "i": i, "total": total, "data": base64.b64encode(parte).decode()})
        if st != 200:
            return fid, st, j
        resp = j
    # picking: el cliente dirige el parseo por pasos (/api/upload/procesar)
    if resp and resp.get("fase") == "armado":
        req = urllib.request.Request(f"{BASE}/api/upload/procesar",
                                     data=json.dumps({"paso": "parseo", "fileId": fid, "nombre": archivo.split("/")[-1]}).encode(),
                                     headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=timeout_procesar) as r:
                return fid, r.status, json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            try:
                return fid, e.code, json.loads(e.read().decode() or "{}")
            except Exception:
                return fid, e.code, {}
    return fid, 200, resp

ok_fails = 0
def caso(nombre, archivo, tipo, esperar_error_substring):
    global ok_fails
    fid, st, j = subir_chunks(archivo, tipo)
    err = str(j.get("error", ""))
    esperado = esperar_error_substring.lower() in err.lower()
    print(f"[{'OK ' if esperado else 'FALLO'}] {nombre}: HTTP {st} | {err[:220]}")
    if not esperado: ok_fails += 1
    return fid, st, j

print("=== 1) casos sin filas (esperamos 400 con diagnóstico) ===")
fid_vacio, _, _ = caso("workbook vacío", "/tmp/test_vacio.xlsx", "picking", "no tiene filas legibles")
print("\n=== 1b) descarga de bytes inmediata (antes de que otra subida las borre) ===")
stD, jD = get(f"{BASE}/api/upload/diag?fileId={fid_vacio}&bytes=2048")
rawD = base64.b64decode(jD.get("b64", "")) if jD.get("b64") else b""
tiene = stD == 200 and rawD[:4].hex() == "504b0304"
print(f"[{'OK ' if tiene else 'FALLO'}] descarga fileId={fid_vacio[:32]}: HTTP {stD} | bytes={len(rawD)} | cabeza={rawD[:4].hex()}")
if not tiene: ok_fails += 1
stL, jL = get(f"{BASE}/api/upload/diag")
print(f"[{'OK ' if stL == 200 and (jL.get('cantidad') or 0) >= 1 else 'FALLO'}] lista diags: HTTP {stL} | cantidad={jL.get('cantidad')}")
if not (stL == 200 and (jL.get('cantidad') or 0) >= 1): ok_fails += 1

fid_hoja1, _, _ = caso("solo encabezados sin datos", "/tmp/test_formulas.xlsx", "picking", "no tiene filas legibles")
fid_html, _, _ = caso("HTML disfrazado de xlsx", "/tmp/test_html.xlsx", "picking", "no tiene filas legibles")
fid_pdf, _, _ = caso("PDF disfrazado de xlsx", "/tmp/test_pdf.xlsx", "picking", "no tiene filas legibles")

print("\n=== 2) caso CSV UTF-16 con extensión .xlsx (debe PROCESAR bien) ===")
fid_csv, st, j = subir_chunks("/tmp/test_csv16.xlsx", "picking")
print(f"[{'OK ' if st == 200 else 'FALLO'}] csv utf16: HTTP {st} | {json.dumps(j, ensure_ascii=False)[:200]}")
if st != 200: ok_fails += 1

print("\n=== 3) título sobre encabezados (400 de mapeo, distinto del de parseo) ===")
fid_tit, st, j = subir_chunks("/tmp/test_titulo.xlsx", "picking")
print(f"info: HTTP {st} | {json.dumps(j, ensure_ascii=False)[:220]}")

print("\n=== 4) diagnóstico remoto (los chunks ya fueron reciclados por las subidas siguientes: esperamos lista con registros) ===")
st, j = get(f"{BASE}/api/upload/diag")
print(f"lista: HTTP {st} | cantidad={j.get('cantidad')}")
for d in (j.get("diags") or [])[:6]:
    print(f"  - fileId={d['fileId'][:40]} | {d['diag']['detalle'][:170]}")
if j.get("cantidad", 0) < 3: ok_fails += 1

print("\n=== 5) regresión: picking real de prueba ===")
fid_r, st, j = subir_chunks("/home/z/my-project/scripts/test_cargas/produccion picking 2026.xlsx", "picking")
print(f"[{'OK ' if st == 200 else 'FALLO'}] picking 2026: HTTP {st} | {json.dumps(j, ensure_ascii=False)[:200]}")
if st != 200: ok_fails += 1

print("\n=== 6) regresión: H61 multipart ===")
import http.client, mimetypes
boundary = "----diagtest"
raw = open("/home/z/my-project/scripts/test_cargas/H61 TEST.xlsx", "rb").read()
body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"tipo\"\r\n\r\nh61\r\n"
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"H61 TEST.xlsx\"\r\n"
        f"Content-Type: application/octet-stream\r\n\r\n").encode() + raw + f"\r\n--{boundary}--\r\n".encode()
req = urllib.request.Request(f"{BASE}/api/upload", data=body,
                             headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}, method="POST")
try:
    with urllib.request.urlopen(req, timeout=300) as r:
        st, j = r.status, json.loads(r.read().decode())
except urllib.error.HTTPError as e:
    st, j = e.code, json.loads(e.read().decode() or "{}")
print(f"[{'OK ' if st == 200 else 'FALLO'}] H61 multipart: HTTP {st} | {json.dumps(j, ensure_ascii=False)[:200]}")
if st != 200: ok_fails += 1

print(f"\n{'='*20} RESULTADO: {'TODO OK' if ok_fails == 0 else f'{ok_fails} fallos'} {'='*20}")
sys.exit(1 if ok_fails else 0)
