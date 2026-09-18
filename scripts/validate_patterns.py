#!/usr/bin/env python3
"""Valida patrones de ubicacion y crosstab motivo x categoria."""
import pandas as pd
import re

pd.set_option('display.max_columns', None)
pd.set_option('display.width', 250)

tm = pd.read_excel("/home/z/my-project/upload/tiempos muertos pasado.xlsx")

# Regex estricta de ubicacion: LETRA-NN-NNN o LETRA N NNN (con espacios)
RE_DASH = re.compile(r'\b([A-Z])-(\d{1,2})-(\d{1,3})\b')
RE_SPACE = re.compile(r'\b([A-Z])\s+(\d{1,2})\s+(\d{1,3})\b')

obs = tm['OBSERVACION'].dropna().astype(str)
n_ub = 0; ejemplos = []
for o in obs:
    m = RE_DASH.search(o.upper()) or RE_SPACE.search(o.upper())
    if m:
        n_ub += 1
        if len(ejemplos) < 20: ejemplos.append(o)
print("Ubicaciones detectadas (regex estricta):", n_ub)
print("Ejemplos:", ejemplos)

# cruces nave x pasillo
def parse_ub(o):
    m = RE_DASH.search(o.upper()) or RE_SPACE.search(o.upper())
    if m: return m.group(1), m.group(2), m.group(3)
    return None, None, None
parsed = obs.apply(parse_ub)
ub_df = pd.DataFrame(parsed.tolist(), index=obs.index, columns=['nave','pasillo','pos'])
ub_ok = ub_df.dropna()
print("\nNaves:", ub_ok['nave'].value_counts().to_dict())
print("Pasillos top 20:", ub_ok['pasillo'].value_counts().head(20).to_dict())
print("Naves x pasillos distintos:", ub_ok.groupby('nave')['pasillo'].nunique().to_dict())

# Crosstab MOTIVO x tiene_ubicacion
mot_ub = tm.loc[obs.index].assign(tiene_ub=ub_df.notna().all(axis=1).reindex(obs.index))
print("\nMOTIVO x tiene ubicacion en obs:")
print(pd.crosstab(mot_ub['MOTIVO'], mot_ub['tiene_ub']).to_string())

# MINUTOS_AJUSTE
print("\nMINUTOS_AJUSTE>0:", (tm['MINUTOS_AJUSTE']>0).sum(), "de", len(tm), "| suma minutos ajustados:", tm['MINUTOS_AJUSTE'].sum())
print("ESTADO A (alta?) vs B:", tm['ESTADO'].value_counts(dropna=False).to_dict())
print("Con ESTADO B: obs_baja:", tm.loc[tm['ESTADO']=='B','OBSERVACION_BAJA'].value_counts().to_dict())
print("Suma MINUTOS total:", tm['MINUTOS'].sum(), " | sin ESTADO:", tm[tm['ESTADO'].isna()]['MINUTOS'].sum())

# top motivos 4 y 10: ejemplos obs
for code in [4,10,3,6,8]:
    sub = tm[tm['MOTIVO']==code]['OBSERVACION'].dropna().astype(str).value_counts().head(6)
    print(f"\nMOTIVO {code} - top obs:")
    for v,c in sub.items(): print(f"   {c:5d}  {v[:60]}")

# H61 checks
h = pd.read_excel("/home/z/my-project/upload/H61.xlsx")
h['fechaDia'] = pd.to_datetime(h['FECHA'].astype(str), format='%Y%m%d')
# operarios con ambos turnos en mismo dia
gt = h.groupby(['FECHA','OPERARIO'])['TURNO'].nunique()
print("\nH61: operario-dias con >1 turno:", (gt>1).sum(), "de", len(gt))
gf = h.groupby(['FECHA','OPERARIO'])['FUNCION'].nunique()
print("H61: operario-dias con >1 funcion:", (gf>1).sum(), "de", len(gf))
# nombres faltantes
print("H61: NOMBRE faltante:", h['NOMBRE'].isna().sum())
# ejemplo operario 12h
hh = h.groupby(['FECHA','OPERARIO'])
hora_cols = [f'HORA_{i:02d}' for i in range(24)]
por = hh[hora_cols].sum()
por['horas'] = (por>0).sum(axis=1)
ej = por[por['horas']==12].head(3)
print("\nEjemplo operarios 12h:")
print(ej.head(3).to_string())
