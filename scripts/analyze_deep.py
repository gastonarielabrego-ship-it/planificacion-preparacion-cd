#!/usr/bin/env python3
"""Analisis profundo: motivos de tiempos muertos + patron 8h/12h en H61."""
import pandas as pd
import re
from collections import Counter

pd.set_option('display.max_columns', None)
pd.set_option('display.width', 250)

# ============ TIEMPOS MUERTOS ============
tm = pd.read_excel("/home/z/my-project/upload/tiempos muertos pasado.xlsx")
print("="*90)
print("TIEMPOS MUERTOS - MOTIVO codes y conteo:")
print(tm.groupby('MOTIVO').agg(n=('MOTIVO','count'), minutos=('MINUTOS','sum')).to_string())

print("\nESTADO A/B:")
print(tm.groupby('ESTADO').agg(n=('ESTADO','count'), minutos=('MINUTOS','sum')).to_string())

print("\nRango fechas:", tm['FECHA'].min(), "-", tm['FECHA'].max())
print("Turnos:", tm['TURNO'].unique())

# OBSERVACION: analizar patrones
obs = tm['OBSERVACION'].dropna().astype(str)
print(f"\nOBSERVACION non-null: {len(obs)} de {len(tm)}")
print("\nTop 40 observaciones mas frecuentes:")
for v, c in obs.value_counts().head(40).items():
    print(f"  {c:6d}  {repr(v[:80])}")

# detectar patrones de ubicacion
def clasifica(o):
    o_u = o.upper()
    if 'APRO' in o_u: return 'APRO'
    if re.search(r'NAVE', o_u): return 'NAVE'
    if 'PASILLO' in o_u: return 'PASILLO'
    if re.search(r'\b[A-Z]-?\d{1,2}-?\d{1,3}\b', o_u): return 'UBICACION formato X-nn-nnn'
    if 'ESPERA' in o_u: return 'ESPERA (genérico)'
    return 'OTRO'

cl = obs.apply(clasifica)
print("\nClasificacion de observaciones por patron:")
print(cl.value_counts().to_string())

# muestras de UBICACION
ub = obs[cl=='UBICACION formato X-nn-nnn'].head(15).tolist()
print("\nMuestras UBICACION:", ub)
apro = obs[cl=='APRO'].head(15).tolist()
print("Muestras APRO:", apro)
nave = obs[cl=='NAVE'].head(15).tolist()
print("Muestras NAVE:", nave)
otro = obs[cl=='OTRO'].head(30).tolist()
print("\nMuestras OTRO (30):")
for o in otro: print("  ", repr(o[:90]))

# ============ H61 ============
h = pd.read_excel("/home/z/my-project/upload/H61.xlsx")
print("\n" + "="*90)
print("H61 - resumen")
print("Rango fechas:", h['FECHA'].min(), "-", h['FECHA'].max())
print("Registros:", len(h))

# horas trabajadas por operario-fecha: cantidad de horas con produccion>0
hora_cols = [f'HORA_{i:02d}' for i in range(24)]
h['horas_activas'] = (h[hora_cols] > 0).sum(axis=1)
h['total_prod'] = h['TOTAL']

# agregar por operario-fecha (un operario tiene varias filas por circuito)
por_op = h.groupby(['FECHA','OPERARIO']).agg(
    horas_activas=('horas_activas','max'),  # max de filas (las filas son por circuito, horas se solapan)
    total=('TOTAL','sum'),
    funcion=('FUNCION','first'),
    turno=('TURNO','first'),
).reset_index()
# recalcular horas activas por operario-fecha sumando por hora con max
hh = h.groupby(['FECHA','OPERARIO'])[hora_cols].sum()
por_op['horas_con_prod'] = (hh > 0).sum(axis=1).values
print("\nDistribucion de horas con produccion por operario-dia:")
print(por_op['horas_con_prod'].value_counts().sort_index().to_string())

# funcion x horas
print("\nHoras con produccion por FUNCION:")
print(por_op.groupby('funcion')['horas_con_prod'].value_counts().unstack(fill_value=0).to_string())

# turnos y rangos horarios por turno (pico/valle)
por_hora_turno = h.groupby('TURNO')[hora_cols].sum()
print("\nProduccion total por hora segun turno:")
print(por_hora_turno.to_string())

# operarios unicos por dia
ops_dia = h.groupby('FECHA')['OPERARIO'].nunique()
print("\nOperarios unicos por dia (media):", round(ops_dia.mean(),1), " min:", ops_dia.min(), " max:", ops_dia.max())

# productividad por hora: total / horas
tot_horas = (hh > 0).sum().sum()
print("Total produccion H61:", h['TOTAL'].sum(), " | Total horas con prod:", tot_horas)

# ACTIVIDAD values
print("\nACTIVIDAD x produccion:")
print(h.groupby('ACTIVIDAD')['TOTAL'].sum().to_string())

# CIRCUITO x produccion
print("\nCIRCUITO x produccion:")
print(h.groupby('CIRCUITO')['TOTAL'].sum().sort_values(ascending=False).to_string())

# ============ OLA ============
ola = pd.read_excel("/home/z/my-project/upload/Ola y Pendiente (1).xlsx", sheet_name=None)
print("\n" + "="*90)
print("OLA Y PENDIENTE - hojas:", len(ola))
# extraer todas las fechas + ola + pendiente
rows = []
for sheet, df in ola.items():
    # fila 0 contiene fechas reales
    fechas = df.iloc[0, 1:].tolist()
    ola_row = df[df.iloc[:,0] == 'Ola total']
    pend_row = df[df.iloc[:,0] == 'Pendiente']
    tot_row = df[df.iloc[:,0] == 'Total']
    for i, f in enumerate(fechas):
        try:
            fdt = pd.to_datetime(f)
        except Exception:
            continue
        r = {'fecha': fdt.date(), 'hoja': sheet,
             'ola': pd.to_numeric(ola_row.iloc[0, i+1], errors='coerce') if len(ola_row) else None,
             'pendiente': pd.to_numeric(pend_row.iloc[0, i+1], errors='coerce') if len(pend_row) else None,
             'total': pd.to_numeric(tot_row.iloc[0, i+1], errors='coerce') if len(tot_row) else None}
        rows.append(r)
oladf = pd.DataFrame(rows).dropna(subset=['fecha'])
# dedupe
oladf = oladf.drop_duplicates(subset=['fecha'], keep='last')
oladf = oladf.sort_values('fecha')
print("Dias con datos:", len(oladf), "| rango:", oladf['fecha'].min(), "-", oladf['fecha'].max())
print("\nUltimos 15 dias:")
print(oladf.tail(15).to_string(index=False))
print("\nOla total anual (media):", round(oladf['ola'].mean(),0))
print("Total dias con ola>0:", (oladf['ola']>0).sum())
