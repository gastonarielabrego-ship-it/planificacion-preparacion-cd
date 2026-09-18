#!/usr/bin/env python3
"""
subir_archivo.py — Carga archivos Excel/CSV grandes a la app de Planificación de Preparación CD.

Diseñado para el archivo de PRODUCCIÓN POR PICKING que excede el límite del chat,
pero también sirve para h61, ola y tiempos muertos.

Requisitos:
    pip install pandas openpyxl requests

Uso básico (picking, el archivo grande):
    python subir_archivo.py --tipo picking --archivo "produccion picking.xlsx"
    python subir_archivo.py --tipo picking --archivo picking.csv --url https://TU-APP.vercel.app

También sirve para el H61 (26 MB, reemplaza los datos previos):
    python subir_archivo.py --tipo h61 --archivo H61.xlsx

Para 'picking' el envío es incremental por lotes (seguro para archivos enormes).
Para 'h61' el envío es en un único lote con reemplazo (la app pre-agrega los datos).

Columnas esperadas para PICKING (se auto-detectan; si difieren, ajustá MAPEO_PICKING):
    fecha      -> columna con la fecha del evento (YYYYMMDD, DD/MM/YYYY, etc.)
    operario   -> código del operario
    horaMin    -> hora del evento (HH:MM, HHMM o minutos desde 00:00)
    bultos     -> cantidad de bultos del evento (opcional)
    soporte    -> identificador del soporte/pallet (opcional)
    circuito   -> circuito/zona (opcional)
"""

import argparse
import json
import sys
import time
import uuid

import pandas as pd
import requests

# ---------------------------------------------------------------------------
# MAPEO PICKING: clave = campo canónico de la app, valor = nombre de la columna
# en tu archivo. Si el valor es None, el script intenta auto-detectar.
# AJUSTÁ ESTE DICCIONARIO si tu archivo usa otros nombres de columna.
# ---------------------------------------------------------------------------
MAPEO_PICKING = {
    "fecha": None,      # ej: "FECHA", "Fecha Picking", "DIA"
    "operario": None,   # ej: "OPERARIO", "Legajo", "USER"
    "horaMin": None,    # ej: "HORA", "HORA_MIN", "TIMESTAMP"
    "bultos": None,     # ej: "BULTOS", "CANTIDAD", "UNIDADES"
    "soporte": None,    # ej: "SOPORTE", "PALLET", "LPN"
    "circuito": None,   # ej: "CIRCUITO", "ZONA"
}

TAMANIO_LOTE = 5000  # filas por request


def detectar_columnas(df: pd.DataFrame, tipo: str) -> dict:
    """Auto-detecta el mapeo de columnas por coincidencia de nombres."""
    cols = {c.strip().upper(): c for c in df.columns}
    deteccion = {}

    def buscar(candidatos):
        for cand in candidatos:
            for k, original in cols.items():
                if cand in k:
                    return original
        return None

    if tipo == "picking":
        deteccion = {
            "fecha": MAPEO_PICKING["fecha"] or buscar(["FECHA", "DIA", "DATE", "FEC"]),
            "operario": MAPEO_PICKING["operario"] or buscar(["OPERARIO", "LEGAJO", "USUARIO", "USER", "OP "]),
            "horaMin": MAPEO_PICKING["horaMin"] or buscar(["HORA", "TIME", "TS ", "TIMESTAMP"]),
            "bultos": MAPEO_PICKING["bultos"] or buscar(["BULTO", "CANTIDAD", "UNIDAD", "CANT", "QTY"]),
            "soporte": MAPEO_PICKING["soporte"] or buscar(["SOPORTE", "PALLET", "LPN", "SOP"]),
            "circuito": MAPEO_PICKING["circuito"] or buscar(["CIRCUITO", "ZONA", "CIRCU"]),
        }
    return deteccion


def leer_archivo(ruta: str) -> pd.DataFrame:
    if ruta.lower().endswith(".csv"):
        for sep in [",", ";", "\t"]:
            df = pd.read_csv(ruta, sep=sep, dtype=str, keep_default_na=False, nrows=5)
            if df.shape[1] >= 3:
                return pd.read_csv(ruta, sep=sep, dtype=str, keep_default_na=False, low_memory=False)
        raise SystemExit("No se pudo determinar el separador del CSV.")
    return pd.read_excel(ruta, dtype=str, keep_default_na=False)


def main():
    ap = argparse.ArgumentParser(description="Sube archivos de datos a la app de Planificación CD")
    ap.add_argument("--tipo", required=True, choices=["picking", "h61", "ola", "tm"], help="tipo de carga")
    ap.add_argument("--archivo", required=True, help="ruta del archivo .xlsx/.xls/.csv")
    ap.add_argument("--url", default="http://localhost:3000", help="URL base de la app (default: http://localhost:3000)")
    ap.add_argument("--hoja", default=None, help="nombre de la hoja (xlsx); default: todas")
    ap.add_argument("--lote", type=int, default=TAMANIO_LOTE, help=f"filas por lote (default {TAMANIO_LOTE})")
    args = ap.parse_args()

    base = args.url.rstrip("/")
    print(f"== Subida de {args.archivo} como '{args.tipo}' hacia {base} ==")

    print("Leyendo archivo…")
    df = leer_archivo(args.archivo)
    if args.hoja and args.tipo != "picking":
        df = pd.read_excel(args.archivo, sheet_name=args.hoja, dtype=str, keep_default_na=False)
    df.columns = [str(c).strip() for c in df.columns]
    print(f"  {len(df):,} filas x {len(df.columns)} columnas")
    print(f"  Columnas encontradas: {list(df.columns)}")

    rows = df.to_dict(orient="records")

    if args.tipo == "picking":
        mapping = detectar_columnas(df, "picking")
        print(f"  Mapeo auto-detectado: {json.dumps(mapping, ensure_ascii=False)}")
        faltan = [k for k in ("fecha", "operario", "horaMin") if not mapping.get(k)]
        if faltan:
            print(f"\n  AVISO: no se detectaron columnas para: {faltan}.")
            print("  Editá MAPEO_PICKING al inicio de este script e indicá los nombres exactos.\n")
            if input("¿Continuar de todas formas? (s/n): ").strip().lower() != "s":
                sys.exit(1)
    else:
        mapping = None

    batch_id = f"py-{int(time.time())}-{uuid.uuid4().hex[:6]}"
    url = f"{base}/api/batch"
    headers = {"Content-Type": "application/json"}
    reemplazar = args.tipo != "picking"  # h61/ola/tm: un solo lote con reemplazo

    if reemplazar and len(rows) > 200_000:
        print(f"\n  El tipo '{args.tipo}' se envía en un único lote ({len(rows):,} filas).")
        print("  Puede tardar unos minutos y usar bastante memoria.\n")

    total_ok = 0
    total_err = 0
    if reemplazar:
        body = {"tipo": args.tipo, "rows": rows, "filename": args.archivo, "batchId": batch_id, "reemplazar": True, "mapping": mapping}
        r = requests.post(url, json=body, headers=headers, timeout=1800)
        if r.status_code != 200:
            print(f"ERROR {r.status_code}: {r.text[:500]}")
            sys.exit(1)
        j = r.json()
        total_ok, total_err = j["insertados"], j["errores"]
        print(f"  Insertadas: {total_ok:,} | Descartadas: {total_err:,}")
    else:
        for i in range(0, len(rows), args.lote):
            lote = rows[i : i + args.lote]
            es_final = (i + args.lote) >= len(rows)
            body = {
                "tipo": "picking",
                "rows": lote,
                "filename": args.archivo,
                "batchId": batch_id,
                "mapping": mapping,
                "final": es_final,
                "reemplazar": i == 0,  # primer lote limpia picking anterior
            }
            ok = False
            for intento in range(3):
                try:
                    r = requests.post(url, json=body, headers=headers, timeout=600)
                    if r.status_code == 200:
                        j = r.json()
                        total_ok += j["insertados"]
                        total_err += j["errores"]
                        ok = True
                        break
                    print(f"  lote {i//args.lote+1}: HTTP {r.status_code} -> reintento")
                except requests.RequestException as e:
                    print(f"  lote {i//args.lote+1}: {e} -> reintento")
                time.sleep(2)
            if not ok:
                print(f"  lote {i//args.lote+1}: FALLIDO tras 3 intentos")
                total_err += len(lote)
            print(f"  progreso: {min(i+args.lote, len(rows)):,}/{len(rows):,} filas", end="\r")

    print()
    print(f"== Listo ==  Insertadas: {total_ok:,} | Descartadas: {total_err:,}")
    if total_err:
        print("   Las filas descartadas no tenían fecha u operario legible.")
    print(f"   Refrescá la app para ver el módulo actualizado. (batch: {batch_id})")


if __name__ == "__main__":
    main()
