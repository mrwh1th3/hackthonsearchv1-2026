"use client";

import { useMemo, useState } from "react";
import { DataTable, dataTableToCsv, type DataTableColumn } from "@/components/shared/data-table";
import { DownloadMenu } from "@/components/shared/download-menu";
import { FilterBar, type FilterChip } from "@/components/shared/filter-bar";
import { TraceDrawer } from "@/components/shared/trace-drawer";
import type { EventoForense } from "@/lib/data";

/**
 * 09 §6: "ver TODO" literal — tabla plana de toda la bitácora de la
 * corrida, filtrable y exportable a CSV. Cada fila es un evento
 * efectivamente persistido (CLAUDE.md regla 2).
 */
export function RawLog({ eventos }: { eventos: EventoForense[] }) {
  const [tipo, setTipo] = useState<string>("todos");
  const [casoId, setCasoId] = useState<string>("todos");
  const [seleccionado, setSeleccionado] = useState<EventoForense | null>(null);

  const tipos = useMemo(() => Array.from(new Set(eventos.map((e) => e.tipo_evento))).sort(), [eventos]);
  const casos = useMemo(() => Array.from(new Set(eventos.map((e) => e.caso_id).filter((c): c is string => Boolean(c)))).sort(), [eventos]);

  const filtrados = useMemo(
    () =>
      eventos
        .filter((e) => tipo === "todos" || e.tipo_evento === tipo)
        .filter((e) => casoId === "todos" || e.caso_id === casoId)
        .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)),
    [eventos, tipo, casoId],
  );

  const columns: Array<DataTableColumn<EventoForense>> = [
    { key: "seq", header: "#", align: "right", render: (e) => e.seq ?? "—" },
    { key: "ts", header: "Timestamp", render: (e) => new Date(e.ts).toLocaleString("es-MX") },
    { key: "caso_id", header: "Caso", render: (e) => (e.caso_id ? e.caso_id.slice(0, 8) + "…" : "—") },
    { key: "tarea_id", header: "Tarea", render: (e) => (e.tarea_id ? e.tarea_id.slice(0, 8) + "…" : "—") },
    { key: "tipo_evento", header: "Evento" },
    { key: "resumen", header: "Resumen", render: (e) => <span className="line-clamp-1 max-w-[360px]">{e.payload.resumen}</span>, csv: (e) => e.payload.resumen },
  ];

  const chips: FilterChip[] = [
    ...(tipo !== "todos" ? [{ key: "tipo", label: `Evento: ${tipo}` }] : []),
    ...(casoId !== "todos" ? [{ key: "caso", label: `Caso: ${casoId.slice(0, 8)}…` }] : []),
  ];

  return (
    <div className="flex flex-col gap-3">
      <FilterBar
        chips={chips}
        onRemoveChip={(k) => (k === "tipo" ? setTipo("todos") : setCasoId("todos"))}
        onClearAll={() => {
          setTipo("todos");
          setCasoId("todos");
        }}
        resultCount={filtrados.length}
      >
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="h-8 rounded-[var(--radius-input)] border border-border bg-surface px-2 text-xs">
          <option value="todos">Todos los eventos</option>
          {tipos.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select value={casoId} onChange={(e) => setCasoId(e.target.value)} className="h-8 rounded-[var(--radius-input)] border border-border bg-surface px-2 text-xs">
          <option value="todos">Todos los casos</option>
          {casos.map((c) => (
            <option key={c} value={c}>
              {c.slice(0, 8)}…
            </option>
          ))}
        </select>
        <DownloadMenu
          options={[
            {
              label: "CSV",
              build: () => ({ content: dataTableToCsv(columns, filtrados), filename: "bitacora.csv", mime: "text/csv;charset=utf-8" }),
            },
          ]}
        />
      </FilterBar>

      <DataTable columns={columns} rows={filtrados} getRowKey={(e) => e.id} onRowClick={setSeleccionado} emptyMessage="Sin eventos para este filtro." />
      <TraceDrawer evento={seleccionado} onOpenChange={(open) => !open && setSeleccionado(null)} />
    </div>
  );
}
