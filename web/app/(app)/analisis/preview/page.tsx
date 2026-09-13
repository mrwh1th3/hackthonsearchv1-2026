import Link from "next/link";
import { notFound } from "next/navigation";
import type { Caso, EventoForense, Senal, Tarea } from "@/lib/data";
import { cn } from "@/lib/utils";
import { AnalisisCanvas, type EstadoAnalisis } from "../[casoId]/analisis-canvas";

export const metadata = { title: "Forense · Preview de análisis" };

/**
 * Preview SOLO de desarrollo del canvas "Análisis en proceso" para iterar la
 * UI sin lanzar investigaciones. Datos de ejemplo en memoria, sin sondeo ni
 * escritura; en producción responde 404 (nunca se muestra como dato real).
 */
export default async function AnalisisPreviewPage({ searchParams }: { searchParams: Promise<{ estado?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { estado } = await searchParams;
  const vista = estado === "terminado" ? "terminado" : estado === "cola" ? "cola" : "proceso";

  return (
    <section className="flex h-[100dvh] max-h-[100dvh] flex-col gap-2.5 overflow-hidden px-[22px] pb-[18px] pt-5">
      <nav className="flex items-center gap-1.5 text-[12px]">
        <span className="text-text-subtle">Preview (dev):</span>
        {(["cola", "proceso", "terminado"] as const).map((v) => (
          <Link
            key={v}
            href={`/analisis/preview?estado=${v}`}
            className={cn(
              "rounded-[var(--radius-pill)] border px-2.5 py-0.5",
              v === vista ? "border-border-strong bg-surface text-text" : "border-border text-text-subtle hover:bg-surface-hover",
            )}
          >
            {v}
          </Link>
        ))}
      </nav>
      <AnalisisCanvas casoId={CASO_ID} etiqueta="Preview · datos de ejemplo" enVivo={false} inicial={fixture(vista)} sondear={false} />
    </section>
  );
}

const CASO_ID = "00000000-0000-4000-8000-00000000pre0";
const CLUSTER = "preview-cluster";

function hace(min: number): string {
  return new Date(Date.now() - min * 60_000).toISOString();
}

function fixture(vista: "cola" | "proceso" | "terminado"): EstadoAnalisis {
  const terminado = vista === "terminado";
  const caso = {
    id: CASO_ID,
    corrida_id: "preview-corrida",
    cluster_id: CLUSTER,
    rfc_principal: "DEMO:ENTIDAD-0",
    rfcs_satelite: ["DEMO:ENTIDAD-1", "DEMO:ENTIDAD-2", "DEMO:ENTIDAD-3"],
    estado: vista === "cola" ? "en_cola" : terminado ? "dictaminado" : "auditando",
    nivel: terminado ? "presuncion_alta" : null,
    tipologia: null,
    origen: null,
    origen_valor: null,
    familias_confirmadas: [],
    monto_en_riesgo: "0",
    moneda: "MXN",
    cobertura_completa: terminado,
    n_reintentos: 0,
    presupuesto_agotado: false,
    creado: hace(12),
    terminado: terminado ? hace(1) : null,
  } as unknown as Caso;
  if (vista === "cola") return { caso, tareas: [], eventos: [], senales: [] };

  const tareas: Tarea[] = [];
  const eventos: EventoForense[] = [];
  const senales: Senal[] = [];
  let seq = 0;

  function tarea(agente: string, ronda: number, estado: string, inicio: number, fin: number | null, pasos: string[]) {
    const id = `t-${agente}-${ronda}`;
    tareas.push({
      id,
      caso_id: CASO_ID,
      corrida_id: "preview-corrida",
      cluster_id: CLUSTER,
      agente,
      ronda,
      intento: 0,
      version_contexto: 1,
      estado,
      idempotency_key: id,
      iniciado: hace(inicio),
      terminado: fin == null ? null : hace(fin),
    });
    pasos.forEach((resumen, i) => {
      seq += 1;
      eventos.push({
        schema_version: "bitacora.v1",
        id: `e-${seq}`,
        corrida_id: "preview-corrida",
        caso_id: CASO_ID,
        tarea_id: id,
        seq,
        ts: hace(inicio - (i + 1) * 0.5),
        tipo_evento: "razonamiento",
        payload: { resumen, referencias: [], operacion_id: null },
        tokens_in: 800 + i * 150,
        tokens_out: 250 + i * 40,
      } as unknown as EventoForense);
    });
    return id;
  }

  function senal(tareaId: string, agente: string, ronda: number, titular: string, ids: string[], confianza: Senal["confianza"], refuta = false) {
    senales.push({
      id: `s-${senales.length + 1}`,
      caso_id: CASO_ID,
      cluster_id: CLUSTER,
      tarea_id: tareaId,
      ronda,
      intento: 0,
      version_contexto: 1,
      familia: "financiera" as Senal["familia"],
      agente,
      titular,
      detalle: {},
      rfcs: ["DEMO:ENTIDAD-0"],
      ids,
      frontera: [],
      confianza,
      refuta,
      creado: hace(10 - senales.length * 0.7),
    });
  }

  const fin1 = tarea("financiero", 1, "completada", 11, 8, ["Revisa pagos del cluster", "Compara montos CFDI contra movimientos bancarios"]);
  senal(fin1, "financiero", 1, "Pagos circulares: el 92% del monto facturado regresa al emisor en menos de 5 días", ["CFDI-0012", "MOV-0441", "MOV-0442", "MOV-0450"], "alta");
  const doc1 = tarea("documental", 1, "completada", 11, 9, ["Revisa conceptos y claves de producto"]);
  senal(doc1, "documental", 1, "Conceptos genéricos repetidos en 14 CFDI sin soporte de entrega", ["CFDI-0012", "CFDI-0013"], "media");
  const rel1 = tarea("relacional", 1, "completada", 11, 8.5, ["Mapea domicilios y representantes compartidos"]);
  senal(rel1, "relacional", 1, "Tres emisores comparten representante legal y domicilio fiscal", ["RFC-DEMO-1", "RFC-DEMO-2"], "alta");
  const tem1 = tarea("temporal", 1, "completada", 11, 9.5, ["Busca ráfagas de facturación"]);
  senal(tem1, "temporal", 1, "Facturación concentrada al cierre de mes, patrón estacional legítimo del sector", ["CFDI-0020"], "baja", true);

  tarea("auditor", 1, terminado ? "completada" : "ejecutando", 7, terminado ? 5 : null, ["Contrasta señales del pizarrón", "Verifica citas por ID"]);
  tarea("defensor", 1, terminado ? "completada" : "pendiente", terminado ? 5 : 0, terminado ? 4 : null, terminado ? ["Busca explicaciones legítimas"] : []);
  if (terminado) {
    const af = tarea("auditor_final", 1, "completada", 4, 2.5, ["Consolida dictamen determinista"]);
    senal(af, "auditor_final", 1, "Presunción alta: pagos circulares + vínculos societarios sobreviven a la defensa", ["CFDI-0012", "MOV-0441"], "alta");
    tarea("redactor", 1, "completada", 2.5, 1, ["Redacta expediente con citas"]);
  }

  return { caso, tareas, eventos, senales };
}
