"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { FilterBar, type FilterChip } from "@/components/shared/filter-bar";
import { EstadoCasoBadge, FamiliaChip, NivelBadge } from "@/components/shared/badges";
import { DownloadMenu } from "@/components/shared/download-menu";
import { construirManifiestoDescarga, filasACsv } from "@/lib/data/descargas";
import { guardarVistaConFallback, listarVistasConFallback, type FuenteVistas } from "@/lib/data/vistas-guardadas";
import type { Caso, Nivel, VistaGuardada } from "@/lib/data";

export interface FilaCola extends Record<string, unknown> {
  caso: Caso;
  razonSocialUntrusted: string | null;
}

const NIVELES: Nivel[] = ["presuncion_alta", "presuncion", "no_concluyente", "anomalia_explicada", "sin_hallazgos"];
const RUTA_VISTA = "/";

interface FiltrosCola {
  nivel: Nivel | "todos";
  soloReintentos: boolean;
  soloPresupuestoAgotado: boolean;
}

const FILTROS_DEFECTO: FiltrosCola = { nivel: "todos", soloReintentos: false, soloPresupuestoAgotado: false };

function filtrosDeBusqueda(params: URLSearchParams): FiltrosCola {
  const nivelParam = params.get("nivel");
  const nivel = nivelParam && (NIVELES as string[]).includes(nivelParam) ? (nivelParam as Nivel) : "todos";
  return {
    nivel,
    soloReintentos: params.get("reintentos") === "1",
    soloPresupuestoAgotado: params.get("presupuesto") === "1",
  };
}

function busquedaDeFiltros(f: FiltrosCola): string {
  const params = new URLSearchParams();
  if (f.nivel !== "todos") params.set("nivel", f.nivel);
  if (f.soloReintentos) params.set("reintentos", "1");
  if (f.soloPresupuestoAgotado) params.set("presupuesto", "1");
  return params.toString();
}

/**
 * 09 §1: tabla de cola con filtros (nivel/estado/tipología/reintentos/
 * presupuesto agotado), orden por nivel descendente y luego monto, filtros
 * persistidos en la URL (compartible/recargable) y "Guardar vista" en
 * localStorage (15 §9; Corte 2 punto 5 — el backend de vistas es 006).
 */
export function QueueTable({ filas }: { filas: FilaCola[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [filtros, setFiltros] = useState<FiltrosCola>(() => filtrosDeBusqueda(searchParams));

  // La URL es la fuente de verdad (enlace compartible/recargable); el
  // estado local solo evita recomputar filtrosDeBusqueda en cada render.
  useEffect(() => {
    setFiltros(filtrosDeBusqueda(searchParams));
  }, [searchParams]);

  const actualizar = useCallback(
    (parcial: Partial<FiltrosCola>) => {
      const siguiente = { ...filtros, ...parcial };
      setFiltros(siguiente);
      const qs = busquedaDeFiltros(siguiente);
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [filtros, pathname, router],
  );

  const { nivel, soloReintentos, soloPresupuestoAgotado } = filtros;

  const filtradas = useMemo(() => {
    const orden = new Map<Nivel, number>(NIVELES.map((n, i) => [n, i]));
    return filas
      .filter((f) => nivel === "todos" || f.caso.nivel === nivel)
      .filter((f) => !soloReintentos || f.caso.n_reintentos > 0)
      .filter((f) => !soloPresupuestoAgotado || f.caso.presupuesto_agotado)
      .sort((a, b) => {
        const byNivel = (a.caso.nivel ? (orden.get(a.caso.nivel) ?? 99) : 99) - (b.caso.nivel ? (orden.get(b.caso.nivel) ?? 99) : 99);
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
    if (key === "nivel") actualizar({ nivel: "todos" });
    if (key === "reintentos") actualizar({ soloReintentos: false });
    if (key === "presupuesto") actualizar({ soloPresupuestoAgotado: false });
  }

  const [vistasVersion, setVistasVersion] = useState(0);

  async function guardarVistaActual() {
    const nombre = window.prompt("Nombre de la vista", `Cola · ${nivel === "todos" ? "todos los niveles" : nivel}`);
    if (!nombre) return;
    const { ok, fuente, error } = await guardarVistaConFallback({ nombre, ruta: RUTA_VISTA, filtros: filtros as unknown as Record<string, unknown> });
    if (ok) {
      toast.success(fuente === "servidor" ? `Vista "${nombre}" guardada en tu cuenta.` : `Vista "${nombre}" guardada en este navegador (sin backend de vistas en este entorno).`);
      setVistasVersion((v) => v + 1);
    } else {
      // `error` viene de un rechazo REAL del servidor (400/401/403/429): se
      // muestra tal cual, nunca se disfraza de "guardado en el navegador"
      // (Corte 3 hallazgo 4 — el fallback a localStorage es solo para
      // "backend no configurado" o sin red).
      toast.error(error ?? "No se pudo guardar la vista.", { duration: Infinity });
    }
  }

  const columns: Array<DataTableColumn<FilaCola>> = [
    { key: "rfc", header: "RFC", render: (f) => <Link href={`/entidades/${encodeURIComponent(f.caso.rfc_principal)}?corrida_id=${f.caso.corrida_id}`} className="font-mono text-xs text-focus hover:underline">{f.caso.rfc_principal}</Link> },
    { key: "razon", header: "Razón social", render: (f) => <span title="dato no confiable, no citable en el dictamen">{f.razonSocialUntrusted ?? "—"}</span> },
    { key: "tipologia", header: "Tipología", render: (f) => f.caso.tipologia ?? "—" },
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
      <FilterBar chips={chips} onRemoveChip={quitarChip} onClearAll={() => actualizar(FILTROS_DEFECTO)} resultCount={filtradas.length} onSaveView={guardarVistaActual}>
        <select
          value={nivel}
          onChange={(e) => actualizar({ nivel: e.target.value as Nivel | "todos" })}
          className="h-8 rounded-[var(--radius-input)] border border-border bg-surface px-2 text-xs"
        >
          <option value="todos">Todos los niveles</option>
          {NIVELES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-text-muted">
          <input type="checkbox" checked={soloReintentos} onChange={(e) => actualizar({ soloReintentos: e.target.checked })} />
          Solo con reintentos
        </label>
        <label className="flex items-center gap-1.5 text-xs text-text-muted">
          <input type="checkbox" checked={soloPresupuestoAgotado} onChange={(e) => actualizar({ soloPresupuestoAgotado: e.target.checked })} />
          Solo presupuesto agotado
        </label>
        <VistasGuardadasMenu onAplicar={(f) => actualizar(f)} version={vistasVersion} />
        <DownloadMenu
          options={[
            {
              label: "CSV (filtrado)",
              build: () => {
                const manifiesto = construirManifiestoDescarga({ nombre: "cola-de-casos", filtros: filtros as unknown as Record<string, unknown> });
                return { content: filasACsv(filtradas.map((f) => f.caso), manifiesto), filename: `${manifiesto.nombre}-${manifiesto.id}.csv`, mime: "text/csv;charset=utf-8" };
              },
            },
            {
              label: "JSON (filtrado, con manifiesto)",
              build: () => {
                const manifiesto = construirManifiestoDescarga({ nombre: "cola-de-casos", filtros: filtros as unknown as Record<string, unknown> });
                return {
                  content: JSON.stringify({ manifiesto, filas: filtradas.map((f) => f.caso) }, null, 2),
                  filename: `${manifiesto.nombre}-${manifiesto.id}.json`,
                  mime: "application/json",
                };
              },
            },
          ]}
        />
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

/**
 * Lista vistas guardadas (`/api/vistas`, 006 §3; cae a localStorage sin
 * backend — ver `lib/data/vistas-guardadas.ts`). `version` fuerza una
 * relectura tras `guardarVistaActual()`: el fetch no se repite solo porque
 * el padre recalculó `filtros`.
 */
function VistasGuardadasMenu({ onAplicar, version }: { onAplicar: (f: FiltrosCola) => void; version: number }) {
  const [vistas, setVistas] = useState<VistaGuardada[]>([]);
  const [fuente, setFuente] = useState<FuenteVistas>("local");

  useEffect(() => {
    let cancelado = false;
    listarVistasConFallback(RUTA_VISTA).then((r) => {
      if (!cancelado) {
        setVistas(r.vistas);
        setFuente(r.fuente);
      }
    });
    return () => {
      cancelado = true;
    };
  }, [version]);

  if (vistas.length === 0) return null;
  return (
    <select
      defaultValue=""
      onChange={(e) => {
        const vista = vistas.find((v) => v.id === e.target.value);
        if (vista) onAplicar(vista.filtros as unknown as FiltrosCola);
        e.target.value = "";
      }}
      className="h-8 rounded-[var(--radius-input)] border border-border bg-surface px-2 text-xs"
      aria-label="Vistas guardadas"
      title={fuente === "servidor" ? "Vistas de tu cuenta" : "Vistas guardadas en este navegador (sin backend de vistas en este entorno)"}
    >
      <option value="" disabled>
        Vistas guardadas…
      </option>
      {vistas.map((v) => (
        <option key={v.id} value={v.id}>
          {v.nombre}
        </option>
      ))}
    </select>
  );
}
