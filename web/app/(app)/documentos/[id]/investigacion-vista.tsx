"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { ResultadosCaso } from "../../casos/[id]/resultados";
import { CanvasHeader } from "@/components/shared/canvas-header";
import type { CasoDetalle, ContrasteCaso, Corrida, EventoForense, Investigacion, TrayectoriaPunto } from "@/lib/data";
import { DocumentWorkspace } from "@/components/editor/document-workspace";
import { ReportChat } from "@/components/editor/report-chat";
import type { EvidenciaCita } from "@/components/editor/cita-drawer";
import type { Documento } from "@/lib/document/tipos";
import { ResumenInvestigacion, type CasoConContexto } from "@/components/shared/investigacion-resumen";

/**
 * Abrir una investigación abre **la pantalla de resultados del diseño con el
 * documento encima** (`design-ref/Agents.dc.html`, bloque `resultsOpen` con
 * `docOpen` en verdadero, líneas 258-292): la hoja blanca de radio 4 y sombra
 * `0 1px 4px` dentro del marco `#f5f4f1`, con su barra "título · Guardado ·
 * herramientas · Cerrar", y debajo la segunda hoja con el **Apéndice — run
 * log**. A la derecha, la columna de chat de 268px.
 *
 * "Cerrar" hace lo del original: baja el documento y deja la vista de
 * hallazgos (stats, timeline, findings) — que aquí es la misma
 * `ResultadosCaso` de `/casos/[id]`, no una copia.
 *
 * El panel lateral (`AppShell`) enlaza aquí con `?doc=0` (2026-09-12: "que no
 * lleve a investigación, que lleve a la página donde están las estadísticas,
 * el chat y eso") porque desde la lista de investigaciones el usuario quiere
 * caer en hallazgos+chat, no en el documento. Cualquier otro enlace (sin ese
 * parámetro) sigue abriendo el documento primero, como pide el bloque de
 * abajo.
 *
 * "Reporte completo" **abre el editor de una**, aquí mismo, a pedido del
 * usuario (2026-09-12): no una hoja de sólo lectura con un enlace a otra
 * ruta, sino el `DocumentWorkspace` real —el mismo editor tipo Docs del
 * expediente, con su chat de propuestas (preguntar no modifica; Aplicar crea
 * versión, regla 11)— dentro del marco de la pantalla de resultados. Ese chat
 * quedó repintado con el lenguaje visual del diseño (burbujas, chips y
 * compositor idénticos a los de esta pantalla), así que la UI del chat de IA
 * es la misma se mire donde se mire.
 *
 * Nada se inventa: el documento es el Markdown **real** del Redactor y la
 * bitácora es la persistida (regla 2). Las secciones
 * "Method/Recommendations/Data notes" del diseño son prosa inventada del
 * bloque de lógica y no se copian.
 */
export function InvestigacionVista({
  etiqueta,
  enVivo,
  investigacion,
  detalle,
  documento,
  versionDocumento,
  evidenciaCitas,
  referenciasValidadas,
  origen,
  bitacora,
  contraste,
  trayectoria,
  corrida,
  casos,
  tokensCorrida,
}: {
  etiqueta: string;
  enVivo: boolean;
  investigacion: Investigacion;
  detalle: CasoDetalle | null;
  documento: Documento | null;
  /** Versión real de `forense.expedientes`, no la 1 fija (evita 409 en el primer autoguardado/propuesta). */
  versionDocumento: number;
  evidenciaCitas: EvidenciaCita[];
  referenciasValidadas: string[];
  origen: "fixture" | "supabase";
  bitacora: EventoForense[];
  contraste: ContrasteCaso | null;
  trayectoria: TrayectoriaPunto[];
  razonSocialUntrusted: string | null;
  corrida: Corrida | null;
  casos: CasoConContexto[];
  tokensCorrida: number | null;
}) {
  const searchParams = useSearchParams();
  const [doc, setDoc] = useState(searchParams.get("doc") !== "0");
  // Versión del expediente que ve el chat lateral (fuera del editor): arranca
  // en la versión REAL vigente (`versionDocumento`, no 1 fija) y sube cuando
  // Aplicar versiona, para que la siguiente pregunta cite la versión correcta.
  const [versionChat, setVersionChat] = useState(versionDocumento);
  // El documento (editor) es una vista DENTRO de esta pantalla, no otra ruta:
  // "Atrás" con el documento abierto cierra el documento y deja los
  // hallazgos/stats de esta misma investigación (feedback 2026-09-12, "q este
  // atras si estan el editor de doc te regresa a donde esta las stats y casos
  // encontradaos"). Solo navega a "/" cuando ya estamos en hallazgos.
  const editorAbierto = doc && detalle && documento;

  return (
    <>
      <CanvasHeader
        etiqueta={etiqueta}
        enVivo={enVivo}
        acciones={
          <div className="flex items-center gap-2">
            {editorAbierto ? (
              <button
                type="button"
                onClick={() => setDoc(false)}
                className="flex h-8 flex-none items-center rounded-[10px] border border-border bg-surface px-3.5 text-[12.5px] text-text-muted transition-colors duration-150 hover:bg-surface-hover"
              >
                Atrás
              </button>
            ) : (
              <Link
                href="/"
                className="flex h-8 flex-none items-center rounded-[10px] border border-border bg-surface px-3.5 text-[12.5px] text-text-muted transition-colors duration-150 hover:bg-surface-hover"
              >
                Atrás
              </Link>
            )}
          </div>
        }
      />
      <div
        className={cn(
          "grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] gap-3.5",
          editorAbierto ? "lg:grid-cols-[minmax(0,1fr)]" : "lg:grid-cols-[minmax(0,1fr)_268px]",
        )}
      >
      <div className={cn("flex min-h-0 flex-col gap-2.5 pr-0.5", editorAbierto ? "overflow-hidden" : "overflow-y-auto")}>
        {editorAbierto ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2.5">
            {/* El editor real, con su chat de propuestas a la derecha. */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <DocumentWorkspace
                casoId={detalle.caso.id}
                rfc={detalle.caso.rfc_principal}
                documento={documento}
                version={versionDocumento}
                estadoRevision="validado"
                nivel={detalle.caso.nivel ?? undefined}
                origen={origen}
                referenciasValidadas={referenciasValidadas}
                evidencia={evidenciaCitas}
                onVersionCambiada={setVersionChat}
              />
            </div>
          </div>
        ) : detalle ? (
          <ResultadosCaso
            detalle={detalle}
            bitacora={bitacora}
            contraste={contraste}
            trayectoria={trayectoria}
            onAbrirReporte={documento ? () => setDoc(true) : undefined}
            extraSecciones={<ResumenInvestigacion corrida={corrida} casos={casos} tokensCorrida={tokensCorrida} />}
            soloResumen
          />
        ) : (
          <div className="flex flex-1 flex-col gap-2.5 rounded-[18px] border border-border bg-surface-muted p-4">
            <p className="m-0 text-[12.5px] text-text-subtle">
              Esta investigación todavía no tiene un caso dictaminado al que mostrarle hallazgos.
            </p>
            <button
              type="button"
              onClick={() => setDoc(true)}
              className="h-8 w-fit rounded-[10px] border border-border bg-surface px-3.5 text-[12.5px] text-text-muted transition-colors duration-150 hover:bg-surface-hover"
            >
              Ver el documento
            </button>
          </div>
        )}

      </div>

      <div className={cn("min-h-0 max-lg:hidden", editorAbierto && "hidden")}>
        {/*
          Mismo chat que dentro del editor (`ReportChat`, contrato
          `editor.solicitud`/`agents.editor`): pregunta o propone sobre EL
          DOCUMENTO de esta investigación, con la evidencia y las citas ya
          validadas como contexto. No dispara investigaciones nuevas —eso era
          `CasoChat`, pensado para el board de corridas, no para el
          expediente— y Aplicar sí versiona aunque el documento esté
          colapsado (feedback 2026-09-12: "sin investigaciones solo contexto
          y edicion del doc").
        */}
        {detalle ? (
          <ReportChat
            casoId={detalle.caso.id}
            version={versionChat}
            seleccion={null}
            evidencia={evidenciaCitas}
            origen={origen}
            modoLectura={false}
            onAplicado={(reporte) => setVersionChat(reporte.version)}
            onLimpiarSeleccion={() => {}}
            onAbrirCita={() => setDoc(true)}
          />
        ) : (
          <div className="flex h-full items-center justify-center rounded-[18px] border border-border bg-surface-muted p-4 text-center text-[12.5px] text-text-subtle">
            Esta investigación todavía no tiene expediente que editar.
          </div>
        )}
      </div>
      </div>
    </>
  );
}
