#!/usr/bin/env python3
"""Analiza la estructura de los 3 archivos Excel subidos."""
import pandas as pd
import sys

pd.set_option('display.max_columns', None)
pd.set_option('display.width', 250)
pd.set_option('display.max_colwidth', 40)

FILES = [
    "/home/z/my-project/upload/Ola y Pendiente (1).xlsx",
    "/home/z/my-project/upload/H61.xlsx",
    "/home/z/my-project/upload/tiempos muertos pasado.xlsx",
]

def describe_df(df, name, sheet):
    print(f"\n{'='*100}")
    print(f"ARCHIVO: {name} | HOJA: {sheet} | shape={df.shape}")
    print(f"{'='*100}")
    print("COLUMNAS:", list(df.columns))
    print("\nDTYPES:")
    print(df.dtypes.to_string())
    print("\nPRIMERAS 8 FILAS:")
    print(df.head(8).to_string())
    print("\nULTIMAS 3 FILAS:")
    print(df.tail(3).to_string())
    # valores unicos de columnas categoricas pequenas
    for c in df.columns:
        try:
            nu = df[c].nunique(dropna=True)
            if nu <= 25 and df.shape[0] > 0:
                print(f"\nUNICOS '{c}' ({nu}):", df[c].dropna().unique()[:25])
        except Exception:
            pass

for f in FILES:
    try:
        xls = pd.ExcelFile(f)
        print(f"\n\n{'#'*100}\nARCHIVO: {f}\nHOJAS: {xls.sheet_names}\n{'#'*100}")
        for sheet in xls.sheet_names:
            try:
                df = pd.read_excel(f, sheet_name=sheet)
                describe_df(df, f.split('/')[-1], sheet)
            except Exception as e:
                print(f"  ERROR leyendo hoja {sheet}: {e}")
    except Exception as e:
        print(f"ERROR abriendo {f}: {e}")
