# Inspección: impacto de la regla TN en feriados.
# Regla nueva: un op-día del turno noche (N) con fecha D pertenece al FERIADO si
# D+1 es feriado (la jornada 23:00 del día D -> 06:00 del día siguiente es la
# "jornada anterior al feriado"). Los turnos M/T son feriado si su fecha lo es.
import sqlite3
from datetime import datetime, timedelta

con = sqlite3.connect('/home/z/my-project/db/custom.db')
cur = con.cursor()

feriados = {}
for fecha_epoch, nombre in cur.execute("SELECT fecha, nombre FROM Feriado ORDER BY fecha"):
    d = datetime.utcfromtimestamp(fecha_epoch / 1000).date()
    feriados[d] = nombre

print(f"Feriados en tabla: {len(feriados)}")
for d, n in sorted(feriados.items()):
    print(f"  {d}  {n}")

# op-días por fecha y turno
rows = cur.execute(
    "SELECT fecha, turno, COUNT(*), SUM(bultos), SUM(horasActivas), COUNT(DISTINCT operario) "
    "FROM H61OpDia GROUP BY fecha, turno"
).fetchall()

por_fecha_turno = {}
for epoch, turno, cnt, bultos, horas, ops in rows:
    d = datetime.utcfromtimestamp(epoch / 1000).date()
    por_fecha_turno[(d, turno)] = (cnt, bultos or 0, horas or 0, ops)

def es_fer_nuevo(d, turno):
    ref = d + timedelta(days=1) if turno == 'N' else d
    return ref in feriados

print("\n=== Detalle por feriado con producción (viejo vs nuevo) ===")
tot_viejo_b = tot_nuevo_b = 0
for d in sorted(feriados):
    turnos = {t: v for (f, t), v in por_fecha_turno.items() if f == d}
    prev = d - timedelta(days=1)
    turnos_prev = {t: v for (f, t), v in por_fecha_turno.items() if f == prev}
    if not turnos and not any(t == 'N' for t in turnos_prev):
        continue
    viejo_b = sum(v[1] for v in turnos.values())
    # nuevo: diurnos del día + TN del día anterior
    nuevo_b = sum(v[1] for t, v in turnos.items() if t != 'N')
    nuevo_b += sum(v[1] for t, v in turnos_prev.items() if t == 'N')
    tot_viejo_b += viejo_b
    tot_nuevo_b += nuevo_b
    print(f"\n{d} {feriados[d]}")
    print(f"  día H : " + ", ".join(f"{t}:{v[0]}op {v[1]:,}b" for t, v in sorted(turnos.items())) or "  (sin producción)")
    print(f"  día H-1 ({prev}): " + (", ".join(f"{t}:{v[0]}op {v[1]:,}b" for t, v in sorted(turnos_prev.items())) or "sin producción"))
    print(f"  feriado bultos  VIEJO={viejo_b:,}  NUEVO={nuevo_b:,}")

print(f"\n=== TOTAL feriado bultos: VIEJO={tot_viejo_b:,}  NUEVO={tot_nuevo_b:,} ===")

# impacto global en la medición normal: bultos que cambian de bando
cambian_a_fer = 0   # TN de H-1: estaban en normal, pasan a feriado
cambian_a_norm = 0  # TN de H: estaban en feriado, pasan a normal
for (d, turno), v in por_fecha_turno.items():
    if turno != 'N':
        continue
    if (d + timedelta(days=1)) in feriados:
        cambian_a_fer += v[1]
    if d in feriados:
        cambian_a_norm += v[1]
print(f"TN día previo a feriado (normal -> feriado): {cambian_a_fer:,} bultos")
print(f"TN del propio feriado (feriado -> normal):   {cambian_a_norm:,} bultos")

# sanity: distribución de turnos global y horas del TN
print("\n=== Op-días por turno (global) ===")
for turno, cnt, b in cur.execute("SELECT turno, COUNT(*), SUM(bultos) FROM H61OpDia GROUP BY turno"):
    print(f"  {turno}: {cnt} op-días, {b:,} bultos")
con.close()
