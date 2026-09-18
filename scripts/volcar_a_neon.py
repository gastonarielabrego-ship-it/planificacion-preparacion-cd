#!/usr/bin/env python3
"""
volcar_a_neon.py — Copia el dataset ya procesado (SQLite local) a la app de produccion
(base PostgreSQL en Neon) usando el endpoint /api/direct-import, en lotes < 4.5 MB.

Uso:
    python scripts/volcar_a_neon.py --url https://TU-APP.vercel.app
    python scripts/volcar_a_neon.py --url http://localhost:3000 --db /ruta/custom.db
"""
import argparse
import json
import sqlite3
import sys
import time

import requests

TABLAS = [
    ("ola", "OlaDia", "reemplazar"),
    ("h61opdia", "H61OpDia", "reemplazar"),
    ("h61turnohora", "H61TurnoHora", "reemplazar"),
    ("h61circuito", "H61Circuito", "reemplazar"),
    ("tm", "TiempoMuerto", "reemplazar"),
]
LOTE = 2000
TAM_MAX_BYTES = 4_000_000  # margen bajo el limite de 4.5 MB de Vercel


def rows_de(con, tabla):
    cur = con.execute(f"SELECT * FROM {tabla}")
    cols = [d[0] for d in cur.description]
    for row in cur:
        yield dict(zip(cols, row))


def serializar(rows):
    # fechas ISO y enteros planos para JSON compacto
    out = []
    for r in rows:
        f = r.get("fecha")
        if hasattr(f, "strftime"):
            r["fecha"] = f.strftime("%Y-%m-%d")
        out.append(r)
    return out


def enviar(url, tabla, rows, reemplazar, batch_id, es_final):
    body = {"tabla": tabla, "rows": rows, "reemplazar": reemplazar, "batchId": batch_id, "final": es_final}
    data = json.dumps(body).encode()
    for intento in range(3):
        try:
            r = requests.post(f"{url}/api/direct-import", data=data,
                              headers={"Content-Type": "application/json"}, timeout=600)
            if r.status_code == 200:
                j = r.json()
                return j.get("insertados", 0), j.get("descartadas", 0)
            print(f"  HTTP {r.status_code}: {r.text[:200]} -> reintento")
        except requests.RequestException as e:
            print(f"  {e} -> reintento")
        time.sleep(2)
    print(f"  FALLO definitivo en lote de {tabla}")
    return 0, len(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:3000")
    ap.add_argument("--db", default="db/custom.db")
    args = ap.parse_args()

    con = sqlite3.connect(args.db)
    con.row_factory = sqlite3.Row
    print(f"== Volcado de {args.db} hacia {args.url} ==")

    for api_tabla, db_tabla, _ in TABLAS:
        total = con.execute(f"SELECT COUNT(*) FROM {db_tabla}").fetchone()[0]
        if total == 0:
            print(f"[{api_tabla}] vacia en origen, se omite")
            continue
        batch_id = f"dump-{db_tabla}-{int(time.time())}"
        print(f"[{api_tabla}] {total:,} filas...")
        buffer = []
        enviados = 0
        desc = 0
        primero = True
        for r in rows_de(con, db_tabla):
            buffer.append(dict(r))
            if len(buffer) >= LOTE:
                payload = serializar(buffer)
                if len(json.dumps(payload).encode()) > TAM_MAX_BYTES:
                    for j in range(0, len(payload), LOTE // 2):
                        i, d = enviar(args.url, api_tabla, payload[j:j + LOTE // 2], primero, batch_id, False)
                        enviados += i; desc += d; primero = False
                else:
                    i, d = enviar(args.url, api_tabla, payload, primero, False)
                    enviados += i; desc += d; primero = False
                buffer = []
                print(f"  {min(enviados+desc+ (len(buffer)), total):,}/{total:,}", end="\r")
        if buffer:
            payload = serializar(buffer)
            # ultimo lote: puede exceder el limite -> partir si hace falta
            data = json.dumps(payload).encode()
            if len(data) > TAM_MAX_BYTES:
                mitad = len(payload) // 2
                i, d = enviar(args.url, api_tabla, payload[:mitad], primero, False)
                enviados += i; desc += d; primero = False
                i, d = enviar(args.url, api_tabla, payload[mitad:], False, batch_id, True)
                enviados += i; desc += d
            else:
                i, d = enviar(args.url, api_tabla, payload, primero, batch_id, True)
                enviados += i; desc += d
        print(f"[{api_tabla}] insertadas: {enviados:,} | descartadas: {desc:,}")

    print("== Listo ==")


if __name__ == "__main__":
    main()
