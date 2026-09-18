#!/usr/bin/env python3
"""Genera un archivo de picking de prueba y valida el flujo completo del script subir_archivo.py."""
import random
from datetime import datetime, timedelta

import pandas as pd

random.seed(42)
base = datetime(2026, 9, 10, 6, 0)
ops = ["P7601", "P7879", "P9579", "VX1011"]
sop = ["S-100233", "S-100451", "S-100777", "S-101020"]
rows = []
t = base
for dia in range(2):
    t = base + timedelta(days=dia)
    for op in ops:
        t = (base + timedelta(days=dia)).replace(hour=6, minute=0)
        soporte_actual = random.choice(sop)
        for i in range(120):
            gap = random.expovariate(1 / 1.2)  # ~1.2 min promedio
            t += timedelta(seconds=gap * 60)
            if random.random() < 0.08:
                soporte_actual = random.choice(sop)
                t += timedelta(minutes=random.uniform(3, 12))  # cambio de soporte = gap largo
            rows.append({
                "FECHA": t.strftime("%Y%m%d"),
                "OPERARIO": op,
                "HORA": t.strftime("%H:%M"),
                "BULTOS": random.randint(1, 4),
                "SOPORTE": soporte_actual,
                "CIRCUITO": random.choice(["AP2", "CH4", "PA2"]),
            })

df = pd.DataFrame(rows)
df.to_excel("/home/z/my-project/data/picking-test.xlsx", index=False)
print(f"generado: {len(df)} eventos, {df['OPERARIO'].nunique()} operarios")
print(df.head(3).to_string())
