"""Inspección de datos H61 para diseñar la pestaña de Capacidad/Ritmo."""
import sqlite3

con = sqlite3.connect('/home/z/my-project/db/custom.db')
cur = con.cursor()

print('--- Totales ---')
print('op-dia:', cur.execute("SELECT COUNT(*), MIN(fecha), MAX(fecha) FROM H61OpDia").fetchone())
print('turno-hora:', cur.execute("SELECT COUNT(*) FROM H61TurnoHora").fetchone())
print('circuito:', cur.execute("SELECT COUNT(*) FROM H61Circuito").fetchone())

print('\n--- Funciones (actividades) distintas ---')
for r in cur.execute("SELECT funcion, COUNT(*) FROM H61OpDia GROUP BY funcion ORDER BY COUNT(*) DESC"):
    print(' ', r)

print('\n--- Turnos ---')
for r in cur.execute("SELECT turno, COUNT(*) FROM H61OpDia GROUP BY turno ORDER BY COUNT(*) DESC"):
    print(' ', r)

print('\n--- Distribucion horasActivas ---')
for r in cur.execute("SELECT horasActivas, COUNT(*) FROM H61OpDia GROUP BY horasActivas ORDER BY horasActivas"):
    print(f'  {r[0]}h: {r[1]} op-dias')

print('\n--- Regla extras: verificar bultosBase + bultosExtras = bultos ---')
print(cur.execute("SELECT SUM(bultos), SUM(bultosBase), SUM(bultosExtras), SUM(extras) FROM H61OpDia").fetchone())

print('\n--- Inicio de turno por turno (min hora con produccion por fecha-turno) ---')
for r in cur.execute("""
  SELECT turno, MIN(hora) AS h0, MAX(hora) AS h1, COUNT(DISTINCT fecha) AS dias
  FROM H61TurnoHora GROUP BY turno"""):
    print(' ', r)

print('\n--- Horas por fecha-turno (contiguidad): casos con huecos ---')
rows = cur.execute("""
  SELECT turno, fecha, COUNT(*) AS n, MIN(hora), MAX(hora), (MAX(hora)-MIN(hora)+1) AS span
  FROM H61TurnoHora GROUP BY turno, fecha HAVING n != span LIMIT 8""").fetchall()
print('  casos con huecos:', len(rows))
for r in rows:
    print(' ', r)

print('\n--- Muestra de dias: operarios por hora (turno M) ---')
rows = cur.execute("""
  SELECT fecha, hora, operarios, bultos FROM H61TurnoHora
  WHERE turno='M' AND fecha = (SELECT MIN(fecha) FROM H61TurnoHora WHERE turno='M')
  ORDER BY hora""").fetchall()
for r in rows:
    print(f'  {r[0]} h={r[1]:02d} ops={r[2]} bultos={r[3]}')

print('\n--- Operarios con extras: ejemplo ---')
rows = cur.execute("""
  SELECT date(fecha/1000,'unixepoch'), operario, turno, horasActivas, bultos, bultosBase, bultosExtras, extras
  FROM H61OpDia WHERE extras > 0 ORDER BY fecha LIMIT 10""").fetchall()
for r in rows:
    print(' ', r)

con.close()
