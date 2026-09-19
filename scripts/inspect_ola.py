"""Inspección rápida de datos de Ola para diseñar la pestaña nueva."""
import sqlite3
from datetime import datetime

con = sqlite3.connect('/home/z/my-project/db/custom.db')
cur = con.cursor()

n, mn, mx = cur.execute("SELECT COUNT(*), MIN(fecha), MAX(fecha) FROM OlaDia").fetchone()
print(f"Total registros Ola: {n} | desde {mn} hasta {mx}")

print("\n--- Primeros 8 registros ---")
for r in cur.execute("SELECT date(fecha/1000, 'unixepoch'), ola, pendiente, total FROM OlaDia ORDER BY fecha LIMIT 8"):
    print(r)

DOW = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab']
print("\n--- Por día de semana (strftime %w: 0=domingo) ---")
rows = cur.execute("""
  SELECT strftime('%w', fecha/1000, 'unixepoch') AS dow, COUNT(*),
         ROUND(AVG(ola),1), ROUND(AVG(pendiente),1), ROUND(AVG(total),1),
         ROUND(AVG(CASE WHEN ola>0 THEN ola END),1),
         SUM(CASE WHEN ola>0 THEN 1 ELSE 0 END),
         SUM(CASE WHEN ola IS NULL THEN 1 ELSE 0 END),
         SUM(CASE WHEN ola=0 THEN 1 ELSE 0 END)
  FROM OlaDia GROUP BY dow ORDER BY dow""").fetchall()
for r in rows:
    dow = int(r[0]) if r[0] is not None else -1
    print(f"{DOW[dow] if dow >= 0 else '?'}: n={r[1]:3d} | ola_prom={r[2]} pend_prom={r[3]} total_prom={r[4]} | ola_prom_cuando_hay={r[5]} | dias_con_ola={r[6]} | ola_null={r[7]} | ola_cero={r[8]}")

print("\n--- Valores por mes ---")
rows = cur.execute("""
  SELECT strftime('%Y-%m', fecha/1000, 'unixepoch') AS mes, COUNT(*),
         ROUND(SUM(ola),0), ROUND(SUM(pendiente),0), ROUND(SUM(total),0),
         ROUND(AVG(ola),1), ROUND(AVG(total),1)
  FROM OlaDia GROUP BY mes ORDER BY mes""").fetchall()
for r in rows:
    print(f"{r[0]}: dias={r[1]:3d} | suma_ola={r[2]:>10} | suma_pend={r[3]:>10} | suma_total={r[4]:>10} | ola_prom={r[5]} total_prom={r[6]}")

print("\n--- Tipos de valor: cuántos con ola>0, pendiente>0, ambos ---")
print(cur.execute("SELECT SUM(CASE WHEN ola>0 THEN 1 ELSE 0 END), SUM(CASE WHEN pendiente>0 THEN 1 ELSE 0 END), SUM(CASE WHEN ola>0 AND pendiente>0 THEN 1 ELSE 0 END), SUM(CASE WHEN total != ola+pendiente THEN 1 ELSE 0 END) FROM OlaDia").fetchone())

print("\n--- Últimos 8 registros (para ver fines de semana recientes) ---")
for r in cur.execute("SELECT date(fecha/1000, 'unixepoch'), strftime('%w', fecha/1000, 'unixepoch'), ola, pendiente, total FROM OlaDia ORDER BY fecha DESC LIMIT 14"):
    print(f"{r[0]} ({DOW[int(r[1])]}): ola={r[2]} pend={r[3]} total={r[4]}")

con.close()
