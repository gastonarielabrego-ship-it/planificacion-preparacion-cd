#!/usr/bin/env python3
"""Inspección rápida: E-8 (picking) + tiempos muertos (categorías)."""
import pandas as pd
import sys

def head(ruta, hoja=None, n=5):
    print(f"\n===== {ruta} =====")
    try:
        xl = pd.ExcelFile(ruta)
        print("Hojas:", xl.sheet_names[:10], ("... (%d)" % len(xl.sheet_names)) if len(xl.sheet_names) > 10 else "")
        nombre = hoja or xl.sheet_names[0]
        df = pd.read_excel(ruta, sheet_name=nombre, nrows=n)
        print(f"Hoja '{nombre}': columnas = {list(df.columns)}")
        print(df.head(n).to_string(max_colwidth=18))
    except Exception as e:
        print("ERROR:", e)

def contar_filas(ruta, hoja=None):
    try:
        df = pd.read_excel(ruta, sheet_name=hoja)
        print(f"   filas: {len(df):,}")
    except Exception as e:
        print("   ERROR filas:", e)

head("scripts/test_cargas/produccion picking 2026.xlsx")
contar_filas("scripts/test_cargas/produccion picking 2026.xlsx")

# E-8 = Productividad X Circuito: mostrar columnas y una muestra
head("upload/Productividad X Circuito (1).xlsx", n=4)

# Tiempos muertos: categorías
print("\n\n########## TIEMPOS MUERTOS ##########")
head("upload/tiempos muertos pasado.xlsx", n=4)
try:
    df = pd.read_excel("upload/tiempos muertos pasado.xlsx")
    cols = [c for c in df.columns if any(k in str(c).upper() for k in ("MOTIVO", "CONCEPTO", "CATEGOR", "TIPO", "DESCRI", "ACTIV", "COD"))]
    print("Posibles columnas de categoría:", cols)
    for c in cols[:3]:
        print(f"\n-- valores únicos de '{c}' (top 30):")
        print(df[c].astype(str).str.strip().value_counts().head(30).to_string())
except Exception as e:
    print("ERROR:", e)

head("scripts/test_cargas/tiempos muertos 2026.xlsx", n=4)
