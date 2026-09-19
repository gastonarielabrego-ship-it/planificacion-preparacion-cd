#!/usr/bin/env python3
"""Genera un xlsx con estructura H61 (FECHA, TURNO, OPERARIO, ..., HORA_00..23)
lo bastante grande (>4,5 MB) para probar la subida por chunks."""
import random
import sys
from datetime import date, timedelta

import xlsxwriter

RUTA = sys.argv[1] if len(sys.argv) > 1 else "/home/z/my-project/tmp/H61_GRANDE_TEST.xlsx"
DIAS = int(sys.argv[2]) if len(sys.argv) > 2 else 240
OPERARIOS = int(sys.argv[3]) if len(sys.argv) > 3 else 140
CIRCUITOS = int(sys.argv[4]) if len(sys.argv) > 4 else 4

random.seed(42)
wb = xlsxwriter.Workbook(RUTA, {"constant_memory": True})
ws = wb.add_worksheet("H61")
cols = ["FECHA", "TURNO", "OPERARIO", "NOMBRE", "FUNCION", "ACTIVIDAD", "CIRCUITO", "TOTAL"] + [f"HORA_{h:02d}" for h in range(24)]
ws.write_row(0, 0, cols)
HORAS_TURNO = {"M": list(range(6, 14)), "T": list(range(14, 22)), "N": [23, 0, 1, 2, 3, 4, 5]}
ACTIVIDADES = ["2", "2", "2", "4", "4", "3", "JAULA"]
fila = 1
d0 = date(2026, 1, 1)
for d in range(DIAS):
    fecha = d0 + timedelta(days=d)
    if fecha.weekday() >= 5 and random.random() < 0.9:
        continue  # fines de semana casi sin actividad
    for p in range(OPERARIOS):
        turno = ["M", "T", "N"][p % 3]
        op = f"P{10000 + p}"
        nombre = f"Operario {p:03d}"
        funcion = "PREPARADOR"
        for c in range(CIRCUITOS):
            vals = [0] * 24
            for h in HORAS_TURNO[turno]:
                vals[h] = random.randint(10, 90)
            total = sum(vals)
            ws.write_row(fila, 0, [fecha.strftime("%d/%m/%Y"), turno, op, nombre, funcion,
                                   random.choice(ACTIVIDADES), f"CIR-{c + 1:02d}", total] + vals)
            fila += 1
wb.close()
import os
print(f"OK filas={fila - 1:,} tamanio={os.path.getsize(RUTA) / 1024 / 1024:.1f} MB -> {RUTA}")
