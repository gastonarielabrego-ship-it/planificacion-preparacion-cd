#!/usr/bin/env python3
"""Genera un picking E-8 GRANDE sintético (estructura real del export WMS) para
probar el pipeline por pasos: 36 operarios x 180 dias x ~130 eventos = ~840k filas
(~25 MB). Uso: python scripts/gen_picking_grande.py [salida.xlsx]"""
import random
import sys
from datetime import datetime, timedelta

import pandas as pd

random.seed(11)
OUT = sys.argv[1] if len(sys.argv) > 1 else "/home/z/my-project/tmp/picking-grande-test.xlsx"

N_OPS = 36
N_DIAS = 180
EVENTOS_DIA = 130

ops = [(f"P{7600+i}", f"Operario {i+1}") for i in range(N_OPS)]
zonas = [f"N{z}" for z in range(1, 7)] + ["PA", "BE"]   # 8 naves
pasillos = [f"{p:02d}" for p in range(1, 25)]
niveles = ["A", "B", "C", "D"]
actividades = ["2", "3", "4", "JAULA"]

rows = []
base = datetime(2026, 2, 1)
for dia in range(N_DIAS):
    fecha = (base + timedelta(days=dia)).strftime("%Y%m%d")
    for cod, nom in ops:
        t = datetime(2026, 2, 1) + timedelta(days=dia)
        t = t.replace(hour=6, minute=0, second=0)
        zona_actual = random.choice(zonas)
        for i in range(EVENTOS_DIA):
            gap = random.expovariate(1 / 1.1)
            if random.random() < 0.06:
                gap += random.uniform(3, 25)
            t += timedelta(seconds=gap * 60)
            if random.random() < 0.12:
                zona_actual = random.choice([z for z in zonas if z != zona_actual])
                t += timedelta(seconds=random.uniform(0.5, 1.8) * 60)
            rows.append((
                cod, nom, fecha, t.strftime("%H:%M:%S"),
                random.choice(actividades), zona_actual, random.choice(pasillos),
                "0", random.choice(niveles), f"7790{random.randint(100000, 999999)}",
                random.choice([6, 8, 12, 24]), random.randint(1, 4),
                round(random.uniform(0.4, 1.6), 2), "",
            ))

df = pd.DataFrame(rows, columns=["CODUTI", "NOMUTI", "FECHA", "HORA", "CODACT", "ZONSTS",
                                 "ALLSTS", "DPLSTS", "NIVSTS", "CODPRO", "PCBPRO", "BULTOS",
                                 "MINUTOS", "ALERTA"])
df.to_excel(OUT, index=False)
import os
print(f"generado: {OUT} | {len(df)} eventos | {os.path.getsize(OUT)/1e6:.1f} MB | "
      f"operarios {df['CODUTI'].nunique()} | dias {df['FECHA'].nunique()} | zonas {df['ZONSTS'].nunique()}")
