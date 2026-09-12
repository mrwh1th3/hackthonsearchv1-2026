"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { FilterBar, type FilterChip } from "@/components/shared/filter-bar";
import { EstadoCasoBadge, FamiliaChip, NivelBadge } from "@/components/shared/badges";
import type { Caso, Nivel } from "@/lib/data";

export interface FilaCola extends Record<string, unknown> {
  caso: Caso;
  razonSocialUntrusted: string | null;
}

const NIVELES: Nivel[] = ["presuncion_alta", "presuncion", "no_concluyente", "anomalia_explicada", "sin_hallazgos"];

/**
 * 09 §1: tabla de cola con filtros (nivel/estado/tipología/reintentos/
 * presupuesto agotado) y orden por nivel descendente, luego monto. Estado
 * local (sin URL): la persistencia de filtros en URL es Corte 2.
 */
export function QueueTable({ filas }: { filas: FilaCola[] }) {
  const [nivel, setNivel] = useState<Nivel | "todos">("todos");
  const [soloReintentos, setSoloReintentos] = useState(false);
  const [soloPresupuestoAgotado, setSoloPresupuestoAgotado] = useState(false);

  const filtradas = useMemo(() => {
    const orden = new Map(NIVELES.map((n, i) => [n, i]));
    return filas
      .filter((f) => nivel === "todos" || f.caso.nivel === nivel)
      .filter((f) => !soloReintentos || f.caso.n_reintentos > 0)
      .filter((f) => !soloPresupuestoAgotado || f.caso.presupuesto_agotado)
      .sort((a, b) => {
        const byNivel = (orden.get(a.caso.nivel) ?? 99) - (orden.get(b.caso.nivel) ?? 99);
        if (byNivel !== 0) return byNivel;
        return Number(b.caso.monto_en_riesgo) - Number(a.caso.monto_en_riesgo);
      });
  }, [filas, nivel, soloReintentos, soloPresupuestoAgotado]);

  const chips: FilterChip[] = [
    ...(nivel !== "todos" ? [{ key: "nivel", label: `Nivel: ${nivel}` }] : []),
    ...(soloReintentos ? [{ key: "reintentos", label: "Con reintentos" }] : []),
    ...(soloPresupuestoAgotado ? [{ key: "presupuesto", label: "Presupuesto agotado" }] : []),
  ];

  function quitarChip(key: string) {
    if (key === "nivel") setNivel("todos");
    if (key === "reintentos") setSoloReintentos(false);
    if (key === "presupuesto") setSoloPresupuestoAgotado(false);
  }

  const columns: Array<DataTableColumn<FilaCola>> = [
    { key: "rfc", header: "RFC", render: (f) => <Link href={`/entidades/${encodeURIComponent(f.caso.rfc_principal)}?corrida_id=${f.caso.corrida_id}`} className="font-mono text-xs text-focus hover:underline">{f.caso.rfc_principal}</Link> },
    { key: "razon", header: "Razón social", render: (f) => <span title="dato no confiable, no citable en el dictamen">{f.razonSocialUntrusted ?? "—"}</span> },
    { key: "tipologia", header: "Tipología", render: (f) => f.caso.tipologia },
    { key: "nivel", header: "Nivel", render: (f) => <NivelBadge nivel={f.caso.nivel} /> },
    { key: "estado", header: "Estado", render: (f) => <EstadoCasoBadge estado={f.caso.estado} nReintentos={f.caso.n_reintentos} /> },
    {
      key: "familias",
      header: "Familias",
      render: (f) => (
        <div className="flex gap-1">
          {f.caso.familias_confirmadas.length === 0 ? <span className="text-text-subtle">—</span> : f.caso.familias_confirmadas.map((fam) => <FamiliaChip key={fam} familia={fam} />)}
        </div>
      ),
    },
    { key: "monto", header: "Monto en riesgo", align: "right", render: (f) => `${f.caso.moneda} ${Number(f.caso.monto_en_riesgo).toLocaleString("es-MX", { minimumFractionDigits: 2 })}` },
    { key: "reintentos", header: "Reintentos", align: "right", render: (f) => f.caso.n_reintentos },
    {
      key: "acciones",
      header: "",
      render: (f) => (
        <Link href={`/casos/${f.caso.id}`} className="text-xs text-focus hover:underline">
          Abrir
        </Link>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <FilterBar chips={chips} onRemoveChip={quitarChip} onClearAll={() => { setNivel("todos"); setSoloReintentos(false); setSoloPresupuestoAgotado(false); }} resultCount={filtradas.length}>
        <select value={nivel} onChange={(e) => setNivel(e.target.value as Nivel | "todos")} className="h-8 rounded-[var(--radius-input)] border border-border bg-surface px-2 text-xs">
          <option value="todos">Todos los niveles</option>
          {NIVELES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-text-muted">
          <input type="checkbox" checked={soloReintentos} onChange={(e) => setSoloReintentos(e.target.checked)} />
          Solo con reintentos
        </label>
        <label className="flex items-center gap-1.5 text-xs text-text-muted">
          <input type="checkbox" checked={soloPresupuestoAgotado} onChange={(e) => setSoloPresupuestoAgotado(e.target.checked)} />
          Solo presupuesto agotado
        </label>
      </FilterBar>

      <DataTable
        columns={columns}
        rows={filtradas}
        getRowKey={(f) => f.caso.id}
        emptyMessage={filas.length === 0 ? "Sin casos en esta corrida." : "Sin coincidencias. Prueba a limpiar los filtros."}
      />
    </div>
  );
}
