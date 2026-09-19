"""Verifica ventanas de turno con datos reales de H61OpHora.

Definición del usuario:
- TM: 6 a 14 (extras posibles hasta las 18 -> buckets 14-17)
- TT: 14 a 22 (extras pueden empezar a las 10 -> buckets 10-13, o extenderse pasando 22)
- TN: 23 a 06 (extras posibles desde las 18 -> buckets 18-22, o hasta las 10 -> buckets 6-9)
La jornada del TN (23:00 del dia D + 00-06 del D+1) se agrupa como dia D.
"""
import sqlite3
from collections import Counter, defaultdict

con = sqlite3.connect('/home/z/my-project/db/custom.db')
cur = con.cursor()

# conjuntos de horas activas por operario-dia con su turno declarado
rows = cur.execute("""
  SELECT o.fecha, o.operario, o.turno, o.horasActivas, GROUP_CONCAT(h.hora) AS horas
  FROM H61OpDia o JOIN H61OpHora h ON h.fecha = o.fecha AND h.operario = o.operario
  GROUP BY o.fecha, o.operario""").fetchall()

patrones = defaultdict(Counter)
for fecha, op, turno, act, horas in rows:
    hs = tuple(sorted(int(x) for x in horas.split(',')))
    if act == (7 if turno == 'N' else 8):  # jornadas completas
        patrones[turno][hs] += 1

for t in ['M', 'T', 'N']:
    print(f"--- Turno {t}: patrones de jornada completa ---")
    for pat, n in patrones[t].most_common(6):
        print(f"  {n:4d} x {list(pat)}")

# rangos de horas activas por turno (todas las jornadas, incluidas extras)
print("\n--- Min/max hora activa por turno (todas las jornadas) ---")
for t in ['M', 'T', 'N']:
    hs = cur.execute("""
      SELECT MIN(h.hora), MAX(h.hora) FROM H61OpHora h
      WHERE h.operario || h.fecha IN (
        SELECT operario || fecha FROM H61OpDia WHERE turno = ?
      )""", (t,)).fetchone()
    print(f"  {t}: {hs}")

# turnos que cruzan: operarios N con horas 18-22 (extras antes) y 6-9 (extras despues)
print("\n--- Horas fuera de ventana por turno ---")
ventanas = {'M': set(range(6, 14)), 'T': set(range(14, 22)), 'N': {23, 0, 1, 2, 3, 4, 5}}
for t, vent in ventanas.items():
    rows_t = [(f, o) for f, o, tu, a, h in rows if tu == t]
    fuera = Counter()
    for fecha, op in rows_t:
        pass
    hs = cur.execute("""
      SELECT h.hora, COUNT(DISTINCT h.operario || h.fecha) FROM H61OpHora h
      JOIN H61OpDia o ON o.fecha = h.fecha AND o.operario = h.operario
      WHERE o.turno = ? GROUP BY h.hora ORDER BY h.hora""", (t,)).fetchall()
    txt = ', '.join(f"h{h}:{n}{'*' if h not in vent else ''}" for h, n in hs)
    print(f"  {t} (ventana {sorted(vent)}): {txt}")
    print(f"     (* = fuera de ventana = extras)")

con.close()
