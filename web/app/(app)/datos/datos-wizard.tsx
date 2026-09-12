"use client";

import Papa from "papaparse";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { FixtureBadge } from "@/components/shared/fixture-badge";
import { validateContract } from "@/lib/contracts/validate";
import { construirInyectar, type FilaInyectar } from "@/lib/ingesta/construir-inyectar";
import { TABLAS_CANONICAS, type TablaCanonica } from "@/lib/ingesta/plantillas";
import type { Corrida, MapperPropuesta } from "@/lib/data";
import { cn } from "@/lib/utils";

const PASOS = ["uploader", "perfil", "mapping", "cobertura", "confirmacion"] as const;
type Paso = (typeof PASOS)[number];
const PASO_LABEL: Record<Paso, string> = {
  uploader: "Subir",
  perfil: "Perfil detectado",
  mapping: "Mapeo",
  cobertura: "Cobertura",
  confirmacion: "Confirmación",
};

/**
 * 15 §13: uploader → perfil → mapping → cobertura → confirmación. Sin
 * archivo real, el asistente usa el ejemplo fixture del mapper (rotulado)
 * solo para poder navegar los pasos; con un CSV real, detecta encabezados
 * y filas con papaparse — el mapeo de columnas mostrado sigue siendo el
 * fixture (no hay backend de mapper IA conectado en este corte), pero
 * "Confirmar e importar" SÍ envía las filas reales del CSV al BFF como
 * `product.inyectar` (contratos 1.2.0), a la tabla canónica elegida. La
 * importación nunca dispara por sí sola una investigación completa — eso
 * lo decide n8n/el usuario después, nunca este wizard.
 */
export function DatosWizard({ mapperEjemplo, corridas }: { mapperEjemplo: MapperPropuesta; corridas: Corrida[] }) {
  const [paso, setPaso] = useState<Paso>("uploader");
  const [archivoNombre, setArchivoNombre] = useState<string | null>(null);
  const [columnasDetectadas, setColumnasDetectadas] = useState<string[] | null>(null);
  const [filasCsv, setFilasCsv] = useState<FilaInyectar[]>([]);
  const [resultadoValidacion, setResultadoValidacion] = useState<{ ok: boolean; errores: number } | null>(null);
  const [tablaDestino, setTablaDestino] = useState<TablaCanonica>("contribuyentes");
  const [corridaBaseId, setCorridaBaseId] = useState(corridas[0]?.id ?? "");
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  const nFilas = filasCsv.length;

  function onArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setArchivoNombre(file.name);
    setEnviado(false);
    Papa.parse<FilaInyectar>(file, {
      header: true,
      skipEmptyLines: true,
      preview: 5000, // tope razonable de UI; el contrato ya limita a 5000 filas por tabla
      complete: (res) => {
        setColumnasDetectadas(res.meta.fields ?? []);
        setFilasCsv(res.data.filter((fila) => Object.keys(fila).length > 0));
        toast.success(`${file.name}: ${res.meta.fields?.length ?? 0} columna(s), ${res.data.length} fila(s) detectada(s).`);
      },
      error: () => toast.error("No se pudo leer el archivo como CSV.", { duration: Infinity }),
    });
  }

  async function confirmarEImportar() {
    if (!corridaBaseId) {
      toast.error("Selecciona una corrida base.", { duration: Infinity });
      return;
    }
    if (filasCsv.length === 0) {
      toast.error("Sube un CSV con al menos una fila antes de importar.", { duration: Infinity });
      return;
    }
    setEnviando(true);
    try {
      const payload = construirInyectar({
        corridaBaseId,
        origen: "ui",
        tablas: { [tablaDestino]: filasCsv },
        nota: archivoNombre ? `Uploader /datos: ${archivoNombre}` : undefined,
        idempotencyKey: crypto.randomUUID(),
      });
      const res = await fetch("/api/inyecciones", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 503 && body.error === "backend_no_configurado") {
        toast.error("Backend de inyección no configurado en este entorno todavía.", { duration: Infinity });
      } else if (res.status === 202) {
        toast.success("Importación recibida.");
        setEnviado(true);
      } else {
        toast.error(`No se pudo importar (${body.error ?? res.status}).`, { duration: Infinity });
      }
    } catch {
      toast.error("No se pudo conectar con el servidor.", { duration: Infinity });
    } finally {
      setEnviando(false);
    }
  }

  function validarMapeo() {
    const resultado = validateContract("ingesta.mapper", mapperEjemplo);
    setResultadoValidacion({ ok: resultado.ok, errores: resultado.errors.length });
    if (resultado.ok) toast.success("El mapeo pasa el validador de contrato ingesta.mapper.");
    else toast.error(`El mapeo no pasa el validador (${resultado.errors.length} error(es)).`, { duration: Infinity });
  }

  const cobertura = useMemo(() => {
    const total = mapperEjemplo.field_mappings.length + mapperEjemplo.missing_required_fields.length;
    const cubiertos = mapperEjemplo.field_mappings.length;
    return total > 0 ? Math.round((cubiertos / total) * 100) : 100;
  }, [mapperEjemplo]);

  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <ol className="mb-4 flex flex-wrap gap-1.5" aria-label="Pasos de importación">
        {PASOS.map((p, i) => (
          <li key={p}>
            <button
              type="button"
              onClick={() => setPaso(p)}
              aria-current={paso === p ? "step" : undefined}
              className={cn(
                "h-8 rounded-full border px-3 text-xs",
                paso === p ? "border-primary bg-primary text-white" : "border-border text-text hover:bg-surface-hover",
              )}
            >
              {i + 1}. {PASO_LABEL[p]}
            </button>
          </li>
        ))}
      </ol>

      {paso === "uploader" && (
        <div className="space-y-3">
          <label className="flex h-32 cursor-pointer flex-col items-center justify-center rounded-[var(--radius-input)] border-2 border-dashed border-border text-sm text-text-subtle hover:bg-surface-hover">
            <input type="file" accept=".csv" className="hidden" onChange={onArchivo} />
            {archivoNombre ? `${archivoNombre}${nFilas > 0 ? ` · ${nFilas} fila(s)` : ""}` : "Arrastra o selecciona un CSV"}
          </label>
          <p className="text-xs text-text-subtle">
            Sin archivo, el asistente continúa con el ejemplo fixture (<code>contracts/fixtures/valid/mapper.json</code>) para poder
            navegar los pasos.
          </p>
          <FixtureBadge origen="contrato" />
          <div className="flex justify-end">
            <button type="button" onClick={() => setPaso("perfil")} className="h-9 rounded-[var(--radius-input)] bg-primary px-4 text-sm text-white hover:bg-primary-hover">
              Continuar
            </button>
          </div>
        </div>
      )}

      {paso === "perfil" && (
        <div className="space-y-3 text-sm">
          <p>
            Adaptador propuesto: <span className="font-medium">{mapperEjemplo.adapter_candidate}</span>
          </p>
          <p className="text-xs text-text-subtle">
            Columnas {columnasDetectadas ? "detectadas en tu CSV" : "de ejemplo (fixture)"}:{" "}
            {(columnasDetectadas ?? mapperEjemplo.field_mappings.map((m) => m.source)).join(", ")}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-text-muted">Tabla canónica destino</span>
              <select
                value={tablaDestino}
                onChange={(e) => setTablaDestino(e.target.value as TablaCanonica)}
                className="h-9 w-full rounded-[var(--radius-input)] border border-border bg-surface px-2 text-sm"
              >
                {TABLAS_CANONICAS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-text-muted">Corrida base (nunca se muta; se clona)</span>
              <select
                value={corridaBaseId}
                onChange={(e) => setCorridaBaseId(e.target.value)}
                className="h-9 w-full rounded-[var(--radius-input)] border border-border bg-surface px-2 text-sm"
              >
                {corridas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <NavButtons onBack={() => setPaso("uploader")} onNext={() => setPaso("mapping")} />
        </div>
      )}

      {paso === "mapping" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-text-subtle">
              {columnasDetectadas
                ? "Aunque tu CSV ya fue leído (paso 1), el mapeo de abajo sigue siendo el ejemplo fixture: no hay backend de mapper IA conectado en este corte, así que no refleja las columnas de tu archivo."
                : "Mapeo de ejemplo (fixture) — sube un CSV en el paso 1 para reemplazar este ejemplo cuando el mapper IA esté conectado."}
            </p>
            <FixtureBadge origen="contrato" />
          </div>
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border">
            <table className="w-full min-w-[560px] border-collapse text-xs">
              <thead>
                <tr className="border-b border-border bg-surface-muted text-left">
                  <th className="p-2">Origen</th>
                  <th className="p-2">Destino</th>
                  <th className="p-2">Confianza</th>
                  <th className="p-2">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {mapperEjemplo.field_mappings.map((m, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="p-2 font-mono">{m.source}</td>
                    <td className="p-2 font-mono">{m.target}</td>
                    <td className="p-2">{m.confidence}</td>
                    <td className="p-2 text-text-subtle">{m.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={validarMapeo} className="h-9 rounded-[var(--radius-input)] border border-border px-3 text-sm hover:bg-surface-hover">
              Validar mapeo (mismo validador que el backend)
            </button>
            {resultadoValidacion && (
              <span className={resultadoValidacion.ok ? "text-xs text-ok" : "text-xs text-error"}>
                {resultadoValidacion.ok ? "Válido contra ingesta.mapper" : `${resultadoValidacion.errores} error(es) de esquema`}
              </span>
            )}
          </div>
          <p className="text-xs text-text-subtle">Propuesta IA y mapeo manual comparten este validador; producir JSON no basta para marcarlo compatible.</p>
          <NavButtons onBack={() => setPaso("perfil")} onNext={() => setPaso("cobertura")} />
        </div>
      )}

      {paso === "cobertura" && (
        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted">
              <div className="h-full bg-primary" style={{ width: `${cobertura}%` }} />
            </div>
            <span className="text-xs text-text-subtle">{cobertura}% cubierto</span>
          </div>
          {mapperEjemplo.missing_required_fields.length > 0 && (
            <div>
              <p className="text-xs font-medium text-warn">Campos requeridos faltantes</p>
              <ul className="list-inside list-disc text-xs text-text-subtle">
                {mapperEjemplo.missing_required_fields.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          )}
          {mapperEjemplo.ambiguities.length > 0 && (
            <div>
              <p className="text-xs font-medium text-text-muted">Ambigüedades (requieren confirmación, nunca se adivinan)</p>
              <ul className="list-inside list-disc text-xs text-text-subtle">
                {mapperEjemplo.ambiguities.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          )}
          {mapperEjemplo.warnings.length > 0 && (
            <div>
              <p className="text-xs font-medium text-text-muted">Advertencias</p>
              <ul className="list-inside list-disc text-xs text-text-subtle">
                {mapperEjemplo.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          <NavButtons onBack={() => setPaso("mapping")} onNext={() => setPaso("confirmacion")} />
        </div>
      )}

      {paso === "confirmacion" && (
        <div className="space-y-3 text-sm">
          <div className="rounded-[var(--radius-input)] border border-border bg-surface-muted p-3 text-xs">
            <p>Resumen del mapeo fixture: {mapperEjemplo.field_mappings.length} columna(s) mapeada(s), {mapperEjemplo.missing_required_fields.length} campo(s) faltante(s) — no describe tu CSV, ver aviso en el paso &ldquo;Mapeo&rdquo;.</p>
            <p className="mt-1 text-text-subtle">
              {nFilas > 0 ? `Se enviarán las ${nFilas} fila(s) reales de tu CSV a la tabla "${tablaDestino}".` : "Sin CSV real, no hay filas que enviar."} La importación nunca dispara por sí sola una investigación completa.
            </p>
          </div>
          {enviado ? (
            <p className="text-xs font-medium text-ok">Importación recibida por el BFF (product.inyectar).</p>
          ) : (
            <button
              type="button"
              onClick={confirmarEImportar}
              disabled={enviando || filasCsv.length === 0}
              className="h-9 rounded-[var(--radius-input)] bg-primary px-4 text-sm text-white hover:bg-primary-hover disabled:opacity-60"
            >
              {enviando ? "Importando…" : "Confirmar e importar"}
            </button>
          )}
          {filasCsv.length === 0 && !enviado && (
            <p className="text-xs text-text-subtle">Sube un CSV en el paso 1 para poder importar (el fixture de ejemplo no se envía).</p>
          )}
          <div className="flex justify-start">
            <button type="button" onClick={() => setPaso("cobertura")} className="h-9 rounded-[var(--radius-input)] border border-border px-4 text-sm hover:bg-surface-hover">
              Atrás
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function NavButtons({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return (
    <div className="flex justify-between">
      <button type="button" onClick={onBack} className="h-9 rounded-[var(--radius-input)] border border-border px-4 text-sm hover:bg-surface-hover">
        Atrás
      </button>
      <button type="button" onClick={onNext} className="h-9 rounded-[var(--radius-input)] bg-primary px-4 text-sm text-white hover:bg-primary-hover">
        Continuar
      </button>
    </div>
  );
}
