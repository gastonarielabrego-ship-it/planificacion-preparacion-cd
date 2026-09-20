#!/usr/bin/env python3
"""Genera un archivo de picking de prueba con la ESTRUCTURA REAL del export WMS:
CODUTI, NOMUTI, FECHA, HORA (hh:mm:ss), CODACT, ZONSTS, ALLSTS, DPLSTS, NIVSTS,
CODPRO, PCBPRO, BULTOS, MINUTOS, ALERTA.
Simula: gaps cortos de levante, muertos largos (>2 min) ocasionales y cambios de
ubicacion/zona (traslados). Valido para probar metricas de mediana, recorridos,
traslados y productividad neta / super neta."""
import random
from datetime import datetime, timedelta

import pandas as pd

random.seed(7)
OPS = [("P7601", "Gomez Juan Carlos"), ("P7879", "Cardozo Roberto Andres"),
       ("P9579", "Caruso Romina Magali"), ("VX1011", "Torres Leandro Gabriel")]
ZONAS = ["N1", "N2", "N3"]                      # naves
PASILLOS = ["01", "02", "03", "04", "05", "06"]
NIVELES = ["A", "B", "C"]
ACTIVIDADES = ["PICK-2", "PICK-4", "REPO"]      # CODACT

rows = []
base = datetime(2026, 9, 10, 6, 0)
for dia in range(2):
    for cod, nom in OPS:
        t = (base + timedelta(days=dia)).replace(hour=6, minute=0)
        zona_actual = random.choice(ZONAS)
        for i in range(150):
            gap = random.expovariate(1 / 1.1)          # ~1.1 min entre levantes
            salto_muerto = random.random() < 0.06       # 6% de muertos largos
            if salto_muerto:
                gap += random.uniform(3, 25)            # muerto evidente > 2 min
            t += timedelta(seconds=gap * 60)
            cambio_zona = random.random() < 0.12
            if cambio_zona:
                zona_actual = random.choice([z for z in ZONAS if z != zona_actual])
                t += timedelta(seconds=random.uniform(0.5, 1.8) * 60)  # traslado corto
            zona = zona_actual
            rows.append({
                "CODUTI": cod,
                "NOMUTI": nom,
                "FECHA": t.strftime("%Y%m%d"),
                "HORA": t.strftime("%H:%M:%S"),
                "CODACT": random.choice(ACTIVIDADES),
                "ZONSTS": zona,
                "ALLSTS": f"{random.choice(PASILLOS)}",
                "DPLSTS": "0",
                "NIVSTS": random.choice(NIVELES),
                "CODPRO": f"7790{random.randint(100000, 999999)}",
                "PCBPRO": random.choice([6, 8, 12, 24]),
                "BULTOS": random.randint(1, 4),
                "MINUTOS": round(random.uniform(0.4, 1.6), 2),
                "ALERTA": "",
            })

df = pd.DataFrame(rows)
df.to_excel("/home/z/my-project/tmp/picking-test.xlsx", index=False)
print(f"generado: {len(df)} eventos | {df['CODUTI'].nunique()} operarios | dias {df['FECHA'].nunique()}")
print(f"zonas: {sorted(df['ZONSTS'].unique())} | actividades: {sorted(df['CODACT'].unique())}")
print(df.head(3).to_string())
