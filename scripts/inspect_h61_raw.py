"""Analiza el archivo H61 crudo: estructura, columnas y ejemplo de un operario con extras."""
import pandas as pd

df = pd.read_excel('/home/z/my-project/scripts/test_cargas/H61 TEST.xlsx')
print('Columnas:', list(df.columns))
print('Filas:', len(df))

# columnas de hora
hcols = [c for c in df.columns if 'HORA' in str(c).upper()]
print('Columnas de hora:', hcols[:26])

# ejemplo: un operario-dia con 12 horas activas
df['_suma_horas'] = df[hcols].fillna(0).sum(axis=1)
df['_activas'] = (df[hcols].fillna(0) > 0).sum(axis=1)

# buscar P11718 2026-01-02
ej = df[(df['OPERARIO'].astype(str) == 'P11718') & (df['FECHA'].astype(str).str.contains('20260102|2026-01-02|02/01/2026', na=False, regex=True))]
print('\nFilas de P11718 el 2026-01-02:', len(ej))
if len(ej):
    cols_show = ['FECHA','TURNO','OPERARIO','FUNCION','CIRCUITO','TOTAL'] + hcols
    cols_show = [c for c in cols_show if c in df.columns]
    for _, r in ej.iterrows():
        vals = {c: (int(r[c]) if pd.notna(r[c]) and str(c) in [str(h) for h in hcols] else r[c]) for c in cols_show}
        # solo horas con valor
        horas_con = {k: v for k, v in vals.items() if str(k).startswith('HORA') and v != 0}
        print('  TURNO:', vals.get('TURNO'), '| CIRCUITO:', vals.get('CIRCUITO'), '| FUNCION:', vals.get('FUNCION'), '| TOTAL:', vals.get('TOTAL'))
        print('  horas:', horas_con)

# como se ve un turno completo ese dia: filas por turno y horas usadas
d = df[df['FECHA'].astype(str).str.contains('20260102|2026-01-02|02/01/2026', na=False, regex=True)]
print('\nEse dia: filas por turno:', d['TURNO'].value_counts().to_dict())
for t in d['TURNO'].dropna().unique():
    dt = d[d['TURNO'] == t]
    usadas = [h for h in hcols if (dt[h].fillna(0) > 0).any()]
    print(f'  turno {t}: horas usadas {[h for h in usadas]}')
