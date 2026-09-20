#!/usr/bin/env python3
"""
subir_archivo.py — Carga archivos Excel/CSV a la app de Planificación de Preparación CD.

MODO 1 — CARPETA (recomendado): detecta automáticamente qué archivo es cada uno
    python subir_archivo.py --carpeta "C:\\cargas" --url https://TU-APP.vercel.app --auto
    python subir_archivo.py --carpeta . --solo-listar        (slo muestra qué detecta, no sube nada)

    Reconoce por nombre de archivo (sin importar mayúsculas):
        H61...                          -> h61      (producción por hora por operario)
        ...picking / piking / E-8...    -> picking  (reporte E-8, producción por picking, va por lotes)
        ...muertos / muerto / TM...     -> tm       (tiempos muertos)
        ...Ola / Pendiente...           -> ola      (matriz mensual; se transforma automáticamente)

MODO 2 — ARCHIVO ÚNICO (control manual del tipo):
    python subir_archivo.py --tipo picking --archivo "produccion picking.xlsx"
    python subir_archivo.py --tipo h61 --archivo H61.xlsx --url https://TU-APP.vercel.app

Requisitos:
    pip install pandas openpyxl requests

Notas:
    - 'picking' se envía incremental por lotes (seguro para archivos enormes).
      El primer lote reemplaza el picking anterior.
    - 'h61'/'ola'/'tm' se envían en un único lote con reemplazo completo.
    - La matriz de "Ola y Pendiente" (33 hojas mensuales) se convierte a registros
      diarios {fecha, ola, pendiente, total} automáticamente, igual que hace la web.
    - Los archivos temporales de Excel (~$xxx.xlsx) se ignoran.
"""

import argparse
import json
import os
import re
import sys
import time
import uuid
from datetime import date, datetime
from datetime import time as hora_time

import pandas as pd
import requests

# ---------------------------------------------------------------------------
# MAPEO PICKING: clave = campo canónico de la app, valor = nombre de la columna
# en tu archivo. Si el valor es None, el script intenta auto-detectar.
#
# ESTRUCTURA CONFIRMADA DEL ARCHIVO DE PICKING (jul 2026):
#   CODUTI=codigo operario | NOMUTI=nombre | FECHA=fecha | HORA=hh:mm:ss
#   CODACT=actividad/circuito | ZONSTS,ALLSTS,DPLSTS,NIVSTS=ubicacion
#   CODPRO=producto (EAN) | PCBPRO=piezas por bulto | BULTOS=cantidad
#   MINUTOS=duracion operacion | ALERTA=flag
#   -> No hay columna de soporte/pallet en el export; si se agrega (LPN/PALLET)
#      se activan las metricas de "tiempo entre soportes" automaticamente.
# ---------------------------------------------------------------------------
MAPEO_PICKING = {
    "fecha": "FECHA",
    "operario": "CODUTI",
    "nombre": "NOMUTI",
    "horaMin": "HORA",
    "bultos": "BULTOS",
    "soporte": None,    # el export no trae soporte/pallet; completar si se agrega
    "circuito": "CODACT",
    "actividad": "CODACT",
    "zona": "ZONSTS",      # zona = nave
    "ubicacion": "ALLSTS", # pasillo/ubicacion
    "nivel": "NIVSTS",
    "minutos": "MINUTOS",  # duracion de la operacion (informativo)
}

TAMANIO_LOTE = 5000  # filas por request


# ---------------------------------------------------------------------------
# Detección de tipo por nombre de archivo
# ---------------------------------------------------------------------------
def detectar_tipo(nombre_archivo: str):
    """Devuelve 'maq'|'h61'|'picking'|'tm'|'ola' según el nombre del archivo, o None."""
    n = nombre_archivo.lower()
    for a, b in (("á", "a"), ("é", "e"), ("í", "i"), ("ó", "o"), ("ú", "u")):
        n = n.replace(a, b)
    # maquinistas (H61 de clarkistas) ANTES que h61: el archivo se llama "h61 maquinista.xlsx"
    if "maquinista" in n or "clarkista" in n:
        return "maq"
    if "h61" in n:
        return "h61"
    # picking = reporte E-8: log de picking o resumen por colaborador (Tiempos E-8 /
    # Productividad X Circuito, el que alimenta el modulo Picking)
    if ("picking" in n or "piking" in n or "pickeo" in n
            or re.search(r"\be-?8\b", n)
            or ("productividad" in n and "circuito" in n)):
        return "picking"
    if "muerto" in n or re.search(r"\btm\b", n):
        return "tm"
    if "ola" in n or "pendiente" in n:
        return "ola"
    return None


def es_grano_resumen(df: pd.DataFrame) -> bool:
    """True si el archivo es el resumen por colaborador del E-8 (Tiempos E-8):
    trae 'Tiempo Muerto'/'Tiempo Total' y NO trae columna de hora evento."""
    cols = {str(c).strip().upper().replace(" ", "").replace("_", "") for c in df.columns}
    con_tiempos = ("TIEMPOMUERTO" in cols) and ("TIEMPOTOTAL" in cols)
    con_hora = any(c in cols for c in ("HORA", "TIMESTAMP"))
    return con_tiempos and not con_hora


def detectar_columnas(df: pd.DataFrame) -> dict:
    """Auto-detecta el mapeo de columnas de picking por coincidencia de nombres."""
    cols = {str(c).strip().upper(): c for c in df.columns}
    deteccion = {}

    def buscar(candidatos):
        for cand in candidatos:
            for k, original in cols.items():
                if cand in k:
                    return original
        return None

    deteccion = {
        "fecha": MAPEO_PICKING["fecha"] or buscar(["FECHA", "DIA", "DATE", "FEC"]),
        "operario": MAPEO_PICKING["operario"] or buscar(["CODUTI", "OPERARIO", "LEGAJO", "USUARIO", "USER", "OP "]),
        "nombre": MAPEO_PICKING.get("nombre") or buscar(["NOMUTI", "NOMBRE"]),
        "horaMin": MAPEO_PICKING["horaMin"] or buscar(["HORA", "TIME", "TS ", "TIMESTAMP"]),
        "bultos": MAPEO_PICKING["bultos"] or buscar(["BULTO", "CANTIDAD", "UNIDAD", "CANT", "QTY"]),
        "soporte": MAPEO_PICKING["soporte"] or buscar(["SOPORTE", "PALLET", "LPN", "SOP"]),
        "circuito": MAPEO_PICKING["circuito"] or buscar(["CODACT", "CIRCUITO", "ZONA", "CIRCU"]),
        "actividad": MAPEO_PICKING.get("actividad") or buscar(["CODACT", "ACTIVIDAD"]),
        "zona": MAPEO_PICKING.get("zona") or buscar(["ZONSTS", "ZONA", "NAVE"]),
        "ubicacion": MAPEO_PICKING.get("ubicacion") or buscar(["ALLSTS", "UBICACION", "PASILLO", "CALLE"]),
        "nivel": MAPEO_PICKING.get("nivel") or buscar(["NIVSTS", "NIVEL"]),
        "minutos": MAPEO_PICKING.get("minutos") or buscar(["MINUTOS", "DURACION"]),
    }
    return deteccion


# ---------------------------------------------------------------------------
# Lectura de archivos
# ---------------------------------------------------------------------------
def leer_generico(ruta: str, hoja=None) -> pd.DataFrame:
    """Lee el archivo como texto (todo string, JSON-safe)."""
    if ruta.lower().endswith(".csv"):
        for sep in [",", ";", "\t"]:
            df = pd.read_csv(ruta, sep=sep, dtype=str, keep_default_na=False, nrows=5)
            if df.shape[1] >= 3:
                return pd.read_csv(ruta, sep=sep, dtype=str, keep_default_na=False, low_memory=False)
        raise SystemExit("No se pudo determinar el separador del CSV.")
    if hoja:
        return pd.read_excel(ruta, sheet_name=hoja, dtype=str, keep_default_na=False)
    return pd.read_excel(ruta, dtype=str, keep_default_na=False)


def _fecha_de_celda(v):
    """Convierte una celda de Excel en date, o None."""
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(v, (pd.Timestamp, datetime)):
        return v.date()
    if isinstance(v, date):
        return v
    if isinstance(v, str):
        s = v.strip()
        for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%y"):
            try:
                return datetime.strptime(s, fmt).date()
            except ValueError:
                continue
        return None
    if isinstance(v, (int, float)):
        # número serial de Excel (días desde 1899-12-30)
        if 30000 < float(v) < 80000:
            return (datetime(1899, 12, 30) + pd.Timedelta(days=float(v))).date()
    return None


def _num_de(v):
    """Convierte una celda en float, o None."""
    if v is None:
        return None
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def preparar_ola(ruta: str):
    """Convierte la matriz mensual de 'Ola y Pendiente' en registros diarios.

    Replica la lógica de la web (src/lib/xlsx.ts): ubica la fila 'OLA TOTAL' /
    'OLA', busca la fila de fechas reales hacia arriba (>=10 fechas) y emite
    {fecha, ola, pendiente, total, hoja} por cada día.
    """
    hojas = pd.read_excel(ruta, sheet_name=None, header=None)
    out = []
    for nombre_hoja, df in hojas.items():
        if df is None or df.empty or df.shape[1] < 2:
            continue
        col0 = df.iloc[:, 0].astype(str).str.strip().str.upper()

        idx_ola = -1
        for i in range(min(len(df), 12)):
            if col0.iloc[i] in ("OLA TOTAL", "OLA"):
                idx_ola = i
                break
        if idx_ola < 0:
            continue

        # fechas reales: primera fila hacia arriba con >=10 fechas (sin la col. de etiquetas)
        fila_fechas = None
        for i in range(idx_ola - 1, -1, -1):
            fechas = [_fecha_de_celda(v) for v in df.iloc[i, 1:]]
            if sum(1 for f in fechas if f) >= 10:
                fila_fechas = fechas
                break
        if fila_fechas is None:
            continue

        # filas de conceptos (primera aparición de cada una)
        ola_row = pend_row = tot_row = None
        for i in range(len(df)):
            et = col0.iloc[i]
            if et in ("OLA TOTAL", "OLA") and ola_row is None:
                ola_row = [_num_de(v) for v in df.iloc[i, 1:]]
            elif et == "PENDIENTE" and pend_row is None:
                pend_row = [_num_de(v) for v in df.iloc[i, 1:]]
            elif et == "TOTAL" and tot_row is None:
                tot_row = [_num_de(v) for v in df.iloc[i, 1:]]
        if ola_row is None:
            continue

        for j, f in enumerate(fila_fechas):
            if not f:
                continue
            o = ola_row[j] if j < len(ola_row) else None
            p = pend_row[j] if pend_row and j < len(pend_row) else None
            t = tot_row[j] if tot_row and j < len(tot_row) else None
            o = o or 0
            p = p or 0
            t = t if t is not None else (o + p)
            out.append({"fecha": f.isoformat(), "ola": o, "pendiente": p, "total": t, "hoja": str(nombre_hoja)})
    return out


def pedir_confirmacion(texto: str, auto: bool) -> bool:
    if auto:
        return True
    try:
        return input(texto).strip().lower() != "n"
    except EOFError:
        return True


def _serializar_valor(v):
    """Convierte valores de pandas/numpy a tipos JSON-safe."""
    if v is None:
        return None
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(v, (pd.Timestamp, datetime)):
        return v.strftime("%Y-%m-%d")
    if isinstance(v, hora_time):
        return v.strftime("%H:%M:%S")
    if isinstance(v, date):
        return v.isoformat()
    if hasattr(v, "item"):  # escalares numpy
        v = v.item()
    if isinstance(v, float):
        return round(v, 6)
    return v


# ---------------------------------------------------------------------------
# Carga de un archivo
# ---------------------------------------------------------------------------
def cargar(tipo: str, ruta: str, base: str, lote: int, auto: bool, reemplazar: bool = False) -> bool:
    print(f"\n== {os.path.basename(ruta)} -> tipo '{tipo}' hacia {base} ==")
    if not os.path.exists(ruta):
        print("   [ERROR] no existe el archivo")
        return False

    if tipo == "ola" and not ruta.lower().endswith(".csv"):
        print("   Convirtiendo matriz mensual a registros diarios…")
        rows = preparar_ola(ruta)
        if not rows:
            print("   [ERROR] no se pudo leer la matriz (¿falta la fila 'Ola total'?)")
            return False
        mapping = None
    else:
        print("   Leyendo archivo…")
        df = leer_generico(ruta)
        df.columns = [str(c).strip() for c in df.columns]
        print(f"   {len(df):,} filas x {len(df.columns)} columnas")
        if tipo == "picking":
            if es_grano_resumen(df):
                # resumen por colaborador (Tiempos E-8): la app auto-detecta todas las
                # columnas server-side (TURNO, Columna1, Sector, Tipo, Tiempo Total/Muerto/Neto/Super Neto)
                mapping = None
                print("   Grano RESUMEN detectado (E-8 por colaborador): la app mapea las columnas sola.")
            else:
                mapping = detectar_columnas(df)
                print(f"   Mapeo auto-detectado: {json.dumps(mapping, ensure_ascii=False)}")
                if not mapping.get("soporte"):
                    print("   [aviso] el archivo no trae columna de soporte/pallet:")
                    print("           los gaps entre pickings se calculan igual, pero las")
                    print("           metricas 'tiempo entre soportes' quedaran vacias.")
                faltan = [k for k in ("fecha", "operario", "horaMin") if not mapping.get(k)]
                if faltan:
                    print(f"\n   AVISO: no se detectaron columnas para: {faltan}.")
                    print("   Editá MAPEO_PICKING al inicio de este script con los nombres exactos.\n")
                    if not pedir_confirmacion("   ¿Continuar de todas formas? (s/n): ", auto):
                        return False
        else:
            mapping = None
        rows = df.to_dict(orient="records")

    if not rows:
        print("   [ERROR] el archivo no tiene filas utilizables")
        return False

    batch_id = f"py-{int(time.time())}-{uuid.uuid4().hex[:6]}"
    url = f"{base}/api/batch"
    headers = {"Content-Type": "application/json"}
    incremental = tipo == "picking"  # por lotes
    reemplazar_unico = not incremental  # h61/ola/tm: un solo lote con reemplazo

    total_ok = 0
    total_err = 0

    if reemplazar_unico:
        print(f"   Enviando {len(rows):,} filas en un único lote (reemplaza los datos previos)…")
        body = {"tipo": tipo, "rows": rows, "filename": os.path.basename(ruta),
                "batchId": batch_id, "reemplazar": True, "mapping": mapping}
        r = requests.post(url, json=body, headers=headers, timeout=1800)
        if r.status_code != 200:
            print(f"   [ERROR] HTTP {r.status_code}: {r.text[:300]}")
            return False
        j = r.json()
        total_ok, total_err = j["insertados"], j["errores"]
    else:
        for i in range(0, len(rows), lote):
            lote_rows = rows[i:i + lote]
            es_final = (i + lote) >= len(rows)
            # picking: el primer lote reemplaza lo anterior
            reemplaza_este = i == 0
            body = {"tipo": tipo, "rows": lote_rows, "filename": os.path.basename(ruta),
                    "batchId": batch_id, "mapping": mapping, "final": es_final,
                    "reemplazar": reemplaza_este}
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
                    print(f"   lote {i // lote + 1}: HTTP {r.status_code} -> reintento")
                except requests.RequestException as e:
                    print(f"   lote {i // lote + 1}: {e} -> reintento")
                time.sleep(2)
            if not ok:
                print(f"   lote {i // lote + 1}: FALLIDO tras 3 intentos")
                total_err += len(lote_rows)
            print(f"   progreso: {min(i + lote, len(rows)):,}/{len(rows):,} filas", end="\r")

    print()
    print(f"   [OK] Insertadas: {total_ok:,} | Descartadas: {total_err:,}")
    if total_err:
        print("   (las descartadas no tenían fecha u operario legible)")
    return total_err == 0


# ---------------------------------------------------------------------------
# Modo carpeta
# ---------------------------------------------------------------------------
def modo_carpeta(carpeta: str, args) -> int:
    if not os.path.isdir(carpeta):
        print(f"[ERROR] la carpeta no existe: {carpeta}")
        return 1

    archivos = sorted(
        f for f in os.listdir(carpeta)
        if f.lower().endswith((".xlsx", ".xls", ".csv")) and not f.startswith("~$")
    )
    if not archivos:
        print(f"[ERROR] no hay archivos .xlsx/.xls/.csv en: {os.path.abspath(carpeta)}")
        return 1

    print(f"== Carpeta: {os.path.abspath(carpeta)} ==")
    plan = []
    for f in archivos:
        tipo = detectar_tipo(f)
        estado = tipo if tipo else "DESCONOCIDO (se ignora)"
        print(f"   {f}  ->  {estado}")
        if tipo:
            plan.append((tipo, os.path.join(carpeta, f)))

    if not plan:
        print("\n[ERROR] ningun archivo fue reconocido.")
        print("  Renombra los archivos incluyendo: h61 / picking / muertos / ola")
        return 1

    if args.solo_listar:
        print("\n(--solo-listar: no se subio nada)")
        return 0

    print(f"\nSe van a cargar {len(plan)} archivo(s). Los datos previos de cada tipo se reemplazan.")
    if not pedir_confirmacion("¿Continuar? (s/n): ", args.auto):
        print("Cancelado.")
        return 0

    fallos = 0
    for tipo, ruta in plan:
        if not cargar(tipo, ruta, args.url.rstrip("/"), args.lote, args.auto, args.reemplazar):
            fallos += 1

    print("\n== RESUMEN ==")
    for tipo, ruta in plan:
        pass
    if fallos:
        print(f"  [ATENCION] {fallos} archivo(s) con problemas. Revisar mensajes de arriba.")
        return 1
    print("  Todo cargado. Refrescá la app para ver los datos actualizados.")
    return 0


def main():
    ap = argparse.ArgumentParser(description="Sube archivos de datos a la app de Planificación CD")
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--carpeta", help="carpeta con los archivos (detecta el tipo de cada uno)")
    src.add_argument("--archivo", help="ruta de un único archivo .xlsx/.xls/.csv")
    ap.add_argument("--tipo", choices=["picking", "h61", "ola", "tm", "maq"], help="tipo de carga (solo con --archivo)")
    ap.add_argument("--url", default="http://localhost:3000", help="URL base de la app (default: http://localhost:3000)")
    ap.add_argument("--hoja", default=None, help="nombre de la hoja (xlsx); default: todas/primera")
    ap.add_argument("--lote", type=int, default=TAMANIO_LOTE, help=f"filas por lote en picking (default {TAMANIO_LOTE})")
    ap.add_argument("--auto", action="store_true", help="no pedir confirmaciones (ideal para el .bat)")
    ap.add_argument("--solo-listar", action="store_true", help="modo carpeta: solo muestra qué detecta, no sube")
    ap.add_argument("--reemplazar", action="store_true", help="(deprecado, se ignora: picking siempre reemplaza lo anterior)")
    args = ap.parse_args()

    if args.carpeta:
        sys.exit(modo_carpeta(args.carpeta, args))

    # modo archivo único
    if not args.tipo:
        args.tipo = detectar_tipo(args.archivo)
        if args.tipo:
            print(f"Tipo auto-detectado por nombre: {args.tipo}")
        else:
            ap.error("--tipo es obligatorio si el nombre del archivo no permite detectarlo")
    sys.exit(0 if cargar(args.tipo, args.archivo, args.url.rstrip("/"), args.lote, args.auto, args.reemplazar) else 1)


if __name__ == "__main__":
    main()
