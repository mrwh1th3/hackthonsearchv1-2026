"use client";

import Papa from "papaparse";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { FixtureBadge } from "@/components/shared/fixture-badge";
import { validateContract } from "@/lib/contracts/validate";
import type { MapperPropuesta } from "@/lib/data";
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
 * archivo real, el asistente usa el ejemplo fixture del mapper (rotulado);
 * con un CSV real, detecta encabezados con papaparse — el mapeo sigue
 * siendo el mismo fixture de columnas destino (no hay backend de mapper IA
 * conectado en este corte). "Confirmar e importar" no dispara nada real:
 * no existe todavía un endpoint de ingesta en el BFF (fuera de
 * api/session, api/investigaciones, api/inyecciones), y la importación
 * nunca debe disparar la llamada de investigación completa aunque exista.
 */
export function DatosWizard({ mapperEjemplo }: { mapperEjemplo: MapperPropuesta }) {
  const [paso, setPaso] = useState<Paso>("uploader");
  const [archivoNombre, setArchivoNombre] = useState<string | null>(null);
  const [columnasDetectadas, setColumnasDetectadas] = useState<string[] | null>(null);
  const [nFilas, setNFilas] = useState<number | null>(null);
  const [resultadoValidacion, setResultadoValidacion] = useState<{ ok: boolean; errores: number } | null>(null);

  function onArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setArchivoNombre(file.name);
    Papa.parse(file, {
      header: true,
      preview: 200,
      complete: (res) => {
        setColumnasDetectadas(res.meta.fields ?? []);
        setNFilas(res.data.length);
        toast.success(`${file.name}: ${res.meta.fields?.length ?? 0} columna(s) detectada(s).`);
      },
      error: () => toast.error("No se pudo leer el archivo como CSV.", { duration: Infinity }),
    });
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
            {archivoNombre ? `${archivoNombre}${nFilas !== null ? ` · ${nFilas} fila(s)` : ""}` : "Arrastra o selecciona un CSV"}
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
          <NavButtons onBack={() => setPaso("uploader")} onNext={() => setPaso("mapping")} />
        </div>
      )}

      {paso === "mapping" && (
        <div className="space-y-3">
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
            <p>Resumen: {mapperEjemplo.field_mappings.length} columna(s) mapeada(s), {mapperEjemplo.missing_required_fields.length} campo(s) faltante(s).</p>
            <p className="mt-1 text-text-subtle">La importación nunca dispara por sí sola una investigación completa.</p>
          </div>
          <button
            type="button"
            disabled
            title="requiere el backend de ingesta (19), no implementado en este corte"
            className="h-9 rounded-[var(--radius-input)] border border-border px-4 text-sm text-text-subtle opacity-60"
          >
            Confirmar e importar
          </button>
          <p className="text-xs text-text-subtle">Deshabilitado: sin endpoint de ingesta en el BFF de este corte (ver solicitudes_coordinador).</p>
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
