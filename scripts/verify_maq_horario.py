#!/usr/bin/env python3
"""Verifica el analisis horario de maquinistas: Σ porHora ≈ movimientos/dia,
desglose tarea×turno presente y horaPico consistente. Uso: [url_base]"""
import json
import sys
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"

with urllib.request.urlopen(f"{BASE}/api/data?modulo=maq", timeout=120) as r:
    d = json.loads(r.read().decode())

assert not d.get("vacio"), "modulo maq vacio"
print(f"registros={d['registros']:,} dias={d['dias']} movimientos={d['movimientos']:,} bultos={d['bultos']:,}")
print(f"tieneHorario={d.get('tieneHorario')} horaPico={d.get('horaPico')}")

ph = d.get("porHora") or []
assert len(ph) == 24, f"porHora debe tener 24 filas, tiene {len(ph)}"
suma_dia = sum(x["total"] for x in ph)
esperado_dia = d["movimientos"] / d["dias"]
print(f"Σ porHora total = {suma_dia:,.1f} mov/día vs movimientos/dias = {esperado_dia:,.1f}")
assert abs(suma_dia - esperado_dia) / esperado_dia < 0.001, "Σ porHora no cuadra con movimientos/dias"

suma_turnos = sum(sum(x[t] for t in ("M", "T", "N")) for x in ph)
print(f"Σ porTurno (M+T+N) = {suma_turnos:,.1f} (diferencia vs total: {suma_dia - suma_turnos:,.1f})")

top = sorted(ph, key=lambda x: -x["total"])[:5]
print("top horas:", [(x["etiqueta"], x["total"]) for x in top])
print("perfil 0-5h:", [(x["etiqueta"], x["total"]) for x in ph[:6]])

pt = d.get("porTurno") or []
for t in pt:
    print(f"turno {t['turno']}: {t['personasPromDia']} pers/día · mov {t['movimientos']:,} · "
          f"apros {t.get('personasPromApros')} pers/día · homog {t.get('personasPromHom')} pers/día")
    for x in t.get("porTareaActividad") or []:
        print(f"   {x['tarea']:<10} {x['actividad']}: {x['personasPromDia']} pers/día · mov {x['movimientos']:,}")
    ap = sum(x["personasPromDia"] or 0 for x in (t.get("porTareaActividad") or []) if x["tarea"] == "apros")
    print(f"   (check: Σ actividades apros = {ap:,.1f} aprox perPersonasProm turno)")

print("movApros global:", d["tareas"]["movApros"], "· movHom:", d["tareas"]["movHom"])
print("[OK] verificacion horario maquinistas")
