#!/usr/bin/env python3
"""Inspección 2: Productividad X Circuito (grano resumen E-8) — valores y conteos."""
import pandas as pd

ruta = "upload/Productividad X Circuito (1).xlsx"
xl = pd.ExcelFile(ruta)
print("Hojas:", xl.sheet_names)
for h in xl.sheet_names:
    df = pd.read_excel(ruta, sheet_name=h)
    print(f"\n-- Hoja '{h}': {len(df):,} filas x {len(df.columns)} cols")
    print("Columnas:", list(df.columns))
    for c in ("Sector", "Tipo", "TURNO", "NOMUTI"):
        if c in df.columns:
            print(f"  valores '{c}':", dict(df[c].astype(str).str.strip().value_counts().head(12)))
    if "Columna1" in df.columns:
        f = pd.to_datetime(df["Columna1"], errors="coerce")
        print("  rango fechas:", f.min(), "->", f.max(), "| meses:", sorted(f.dt.strftime('%Y-%m').dropna().unique()))
    print("  operarios distintos:", df["OPERARIO"].nunique() if "OPERARIO" in df.columns else "n/a")
    print("  suma Bultos:", pd.to_numeric(df.get("Bultos"), errors="coerce").sum())
    print("  suma Tiempo Total:", pd.to_numeric(df.get("Tiempo Total"), errors="coerce").sum())
    print("  suma Tiempo Muerto:", pd.to_numeric(df.get("Tiempo Muerto"), errors="coerce").sum())
    print(df.head(3).to_string())
