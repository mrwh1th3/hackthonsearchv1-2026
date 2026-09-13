"use client";

import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { AlertTriangle, Check, FileText, History, Loader2, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { estadoCitas } from "@/lib/document/citas";
import { hashTexto, normalizarDocumento } from "@/lib/document/documento";
import { construirIndice } from "@/lib/document/secciones";
import type { Documento, Reporte } from "@/lib/document/tipos";
import { cn } from "@/lib/utils";

import { guardarBorradorRemoto, leerVersiones, revertirVersion, uuid } from "./cliente";
import { CitaDrawer, type EvidenciaCita } from "./cita-drawer";
import { DescargasExpediente } from "./descargas";
import { EstilosHoja } from "./estilos-hoja";
import { AtributosBloque, CitasDecoradas } from "./extensiones";
import { IndiceSecciones } from "./indice-secciones";
import { ReportChat, type SeleccionUI } from "./report-chat";
import { EditorToolbar } from "./toolbar";
import { VersionDiff } from "./version-diff";

/**
 * `DocumentWorkspace` (15 §10, 09 §8): editor tipo Docs sobre el JSON canónico
 * del expediente.
 *
 * - Hoja A4 de 794 px con zoom 75/100/125/150 y "ajustar ancho"; en móvil,
 *   continuo, sin recortar texto.
 * - Índice plegable de las diez secciones (las ausentes se declaran, no se
 *   inventan), toolbar compacta y chat de 360 px redimensionable.
 * - Modos Editar / Sugerir / Lectura. En "Sugerir" el documento no se edita a
 *   mano: los cambios entran por propuesta con diff (Aplicar/Descartar).
 * - Autoguardado 1 s con `version_base` y control optimista; `Cmd/Ctrl+S` lo
 *   fuerza. El autoguardado NO crea versión.
 * - Citas como chips clicables (decoración de ProseMirror, no nodos): rojas si
 *   el ID no está en evidencia validada. Con citas por revisar el expediente
 *   sigue guardándose, pero no es entregable.
 */

export interface PropsDocumentWorkspace {
  casoId: string;
  rfc: string;
  documento: Documento;
  version: number;
  estadoRevision: "borrador" | "validado";
  referenciasValidadas: string[];
  evidencia: EvidenciaCita[];
  origen: "fixture" | "supabase";
  nivel?: string;
  /** Avisa cuando la versión vigente cambia aquí (p. ej. editar una validada abre la siguiente). */
  onVersionCambiada?: (version: number) => void;
}

type Modo = "editar" | "sugerir" | "lectura";
type EstadoGuardado =
  | { tipo: "limpio" }
  | { tipo: "guardando" }
  | { tipo: "guardado"; hora: string }
  | { tipo: "conflicto"; versionActual: number }
  | { tipo: "validada"; versionActual: number }
  | { tipo: "error"; mensaje: string };

const ZOOMS = [75, 100, 125, 150] as const;

/** El historial son reportes completos (`editor.reporte`), con su documento. */
type VersionHistorial = Reporte;

export function DocumentWorkspace({
  casoId,
  rfc,
  documento,
  version: versionInicial,
  estadoRevision,
  referenciasValidadas,
  evidencia,
  origen,
  nivel,
  onVersionCambiada,
}: PropsDocumentWorkspace) {
  const validadas = useMemo(() => new Set(referenciasValidadas), [referenciasValidadas]);
  const [documentoActual, setDocumentoActual] = useState<Documento>(documento);
  const [version, setVersion] = useState(versionInicial);
  // Sólo se escribe: la píldora que lo mostraba se retiró (feedback 2026-09-12);
  // el estado se conserva porque `adoptarVersion` lo actualiza y el historial lo usa.
  const [, setRevision] = useState(estadoRevision);
  const [modo, setModo] = useState<Modo>("editar");
  const [zoom, setZoom] = useState<number | "ancho">(100);
  const [guardado, setGuardado] = useState<EstadoGuardado>({ tipo: "limpio" });
  const [seleccion, setSeleccion] = useState<SeleccionUI | null>(null);
  const [citaAbierta, setCitaAbierta] = useState<string | null>(null);
  const [historialAbierto, setHistorialAbierto] = useState(false);
  const [historial, setHistorial] = useState<VersionHistorial[]>([]);
  const [comparando, setComparando] = useState<number | null>(null);
  const [titulo, setTitulo] = useState(`Reporte ${rfc}`);

  const lienzoRef = useRef<HTMLDivElement>(null);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const versionRef = useRef(version);
  // Documento tal como quedó al montar (ya normalizado por las extensiones) o
  // tras el último guardado. Abrir el reporte hace que TipTap normalice el
  // contenido y dispare `onUpdate` sin que nadie escriba: sin esta referencia
  // eso lanzaba un autoguardado y el servidor lo rechazaba sólo por mirar.
  const baseRef = useRef<string | null>(null);
  versionRef.current = version;

  const abrirCita = useCallback((referencia: string) => setCitaAbierta(referencia), []);

  const editor = useEditor({
    immediatelyRender: false,
    editable: modo === "editar",
    extensions: [
      // `codeBlock` y `hardBreak` quedan fuera: `editor.block` no los admite y
      // un solo Shift+Enter invalidaría el documento.
      StarterKit.configure({ codeBlock: false, hardBreak: false }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      AtributosBloque,
      CitasDecoradas.configure({ referenciasValidadas: validadas, onCitaClick: abrirCita }),
    ],
    content: documento,
    editorProps: {
      attributes: { class: "hoja-prosa", "aria-label": "Documento del reporte", role: "textbox" },
    },
    onCreate: ({ editor: instancia }) => {
      baseRef.current = JSON.stringify(normalizarDocumento(instancia.getJSON()));
    },
    onUpdate: ({ editor: instancia }) => {
      const actualizado = normalizarDocumento(instancia.getJSON());
      setDocumentoActual(actualizado);
      const serializado = JSON.stringify(actualizado);
      // La primera normalización (ids de bloque, etc.) llega antes o sin `onCreate`: se adopta como base.
      if (baseRef.current === null) {
        baseRef.current = serializado;
        return;
      }
      if (serializado === baseRef.current) return;
      programarAutoguardado(actualizado);
    },
    onSelectionUpdate: ({ editor: instancia }) => {
      const { from, to, empty } = instancia.state.selection;
      if (empty) {
        setSeleccion(null);
        return;
      }
      const ids: string[] = [];
      instancia.state.doc.nodesBetween(from, to, (nodo) => {
        const id = nodo.attrs?.id as string | undefined;
        if (id && (nodo.isTextblock || nodo.type.name === "table") && !ids.includes(id)) ids.push(id);
      });
      if (ids.length === 0) {
        setSeleccion(null);
        return;
      }
      const texto = instancia.state.doc.textBetween(from, to, "\n", " ");
      setSeleccion({ from, to, block_ids: ids.slice(0, 100), texto_hash: hashTexto(texto), texto });
    },
  });

  useEffect(() => {
    editor?.setEditable(modo === "editar");
  }, [editor, modo]);

  // --- Autoguardado (15 §10): 1 s sin escritura; no crea versión -----------
  const guardar = useCallback(
    async (doc: Documento) => {
      setGuardado({ tipo: "guardando" });
      const resultado = await guardarBorradorRemoto({ caso_id: casoId, version_base: versionRef.current, documento: doc });
      if (resultado.ok) {
        baseRef.current = JSON.stringify(doc);
        // Editar una versión validada abre la siguiente como borrador: se sigue sobre esa.
        if (resultado.datos.version_base > versionRef.current) {
          versionRef.current = resultado.datos.version_base;
          setVersion(resultado.datos.version_base);
          setRevision("borrador");
          onVersionCambiada?.(resultado.datos.version_base);
        }
        setGuardado({ tipo: "guardado", hora: new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) });
        return;
      }
      if (resultado.error.error === "conflicto_version" && resultado.error.version_actual) {
        // El borrador local NO se descarta ni se sobrescribe con el servidor.
        setGuardado({ tipo: "conflicto", versionActual: resultado.error.version_actual });
        return;
      }
      if (resultado.error.error === "version_validada" && resultado.error.version_actual) {
        setGuardado({ tipo: "validada", versionActual: resultado.error.version_actual });
        return;
      }
      setGuardado({
        tipo: "error",
        mensaje:
          resultado.error.error === "backend_no_configurado"
            ? "Sin backend configurado: el borrador se conserva aquí pero no se está guardando; no cierres la pestaña."
            : `No se pudo guardar (${resultado.error.error}).`,
      });
    },
    [casoId, onVersionCambiada],
  );

  const programarAutoguardado = useCallback(
    (doc: Documento) => {
      if (temporizador.current) clearTimeout(temporizador.current);
      temporizador.current = setTimeout(() => void guardar(doc), 1000);
    },
    [guardar],
  );

  useEffect(() => {
    function alTeclado(evento: KeyboardEvent) {
      if ((evento.metaKey || evento.ctrlKey) && evento.key.toLowerCase() === "s") {
        evento.preventDefault();
        if (temporizador.current) clearTimeout(temporizador.current);
        void guardar(documentoActual);
      }
    }
    window.addEventListener("keydown", alTeclado);
    return () => window.removeEventListener("keydown", alTeclado);
  }, [documentoActual, guardar]);

  useEffect(() => () => { if (temporizador.current) clearTimeout(temporizador.current); }, []);

  // --- Versión nueva aplicada ---------------------------------------------
  function adoptarVersion(reporte: Reporte, revisarCitas?: boolean) {
    if (temporizador.current) clearTimeout(temporizador.current); // no guardar el documento viejo
    setVersion(reporte.version);
    versionRef.current = reporte.version;
    setRevision(reporte.estado_revision);
    setDocumentoActual(reporte.contenido_json);
    // `emitUpdate: false` evita disparar onUpdate y, con él, un autoguardado espurio.
    editor?.commands.setContent(reporte.contenido_json, { emitUpdate: false });
    baseRef.current = editor ? JSON.stringify(normalizarDocumento(editor.getJSON())) : null;
    setGuardado({ tipo: "limpio" });
    if (revisarCitas) toast.warning("La versión nueva tiene citas por revisar");
  }

  // Referencia estable: `cargarHistorial` se memoiza por caso y no debe
  // quedarse con el `editor` nulo del primer render.
  const adoptarVersionRef = useRef<((reporte: Reporte, revisarCitas?: boolean) => void) | null>(null);
  adoptarVersionRef.current = adoptarVersion;

  const cargarHistorial = useCallback(
    async (opciones: { adoptarVigente?: boolean } = {}): Promise<void> => {
      const resultado = await leerVersiones(casoId);
      if (!resultado.ok) {
        if (!opciones.adoptarVigente) toast.error("No se pudo leer el historial de versiones");
        return;
      }
      // Respuesta sin lista (backend antiguo o cuerpo inesperado): no se rompe
      // el editor por el historial.
      const lista = Array.isArray(resultado.datos?.versiones) ? resultado.datos.versiones : [];
      setHistorial(lista);
      setComparando(lista.length > 1 ? lista[lista.length - 2].version : null);

      const vigente = lista[lista.length - 1];
      if (opciones.adoptarVigente && vigente && vigente.version > versionRef.current) {
        // El expediente avanzó desde que se renderizó la página (Aplicar y
        // recarga, u otra pestaña). Montar en la versión vieja dejaría toda
        // escritura en conflicto permanente.
        adoptarVersionRef.current?.(vigente);
        toast.info(`El reporte ya estaba en la versión ${vigente.version}: se cargó esa.`);
      }
    },
    [casoId],
  );

  // Sincronización al montar: una sola vez, cuando el editor ya existe.
  const yaSincronizado = useRef(false);
  useEffect(() => {
    if (!editor || yaSincronizado.current) return;
    yaSincronizado.current = true;
    void cargarHistorial({ adoptarVigente: true });
  }, [editor, cargarHistorial]);

  async function revertir(objetivo: number) {
    const resultado = await revertirVersion({
      caso_id: casoId,
      version_objetivo: objetivo,
      version_base: version,
      idempotency_key: uuid(),
    });
    if (!resultado.ok) {
      toast.error(
        resultado.error.error === "conflicto_version"
          ? `El reporte ya está en la versión ${resultado.error.version_actual}.`
          : `No se pudo revertir (${resultado.error.error}).`,
      );
      return;
    }
    adoptarVersion(resultado.datos.reporte);
    toast.success(`Versión ${resultado.datos.version} creada a partir de la ${objetivo}`);
    // CLAUDE.md regla 2: una reversión sin evento en `forense.bitacora` no es
    // auditable, y eso se dice. Solo el `false` explícito.
    if (resultado.datos.bitacora === false) {
      toast.warning("La reversión no dejó registro en la bitácora: este entorno no persiste trazabilidad.");
    }
    setHistorialAbierto(false);
  }

  const indice = useMemo(() => construirIndice(documentoActual), [documentoActual]);
  const citas = useMemo(() => estadoCitas(documentoActual, validadas), [documentoActual, validadas]);

  function irABloque(blockId: string) {
    const escapado = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(blockId) : blockId.replace(/["\\]/g, "\\$&");
    const nodo = lienzoRef.current?.querySelector(`[data-id="${escapado}"]`);
    nodo?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const escala = zoom === "ancho" ? 1 : zoom / 100;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="document-workspace">
      <EstilosHoja />

      {/*
        Dos contenedores hermanos, idénticos a `/documentos/[id]`: uno
        grande a la izquierda con **todo** el documento —cabecera, menús,
        toolbar, índice y hoja— y el del chat de IA a la derecha. Nada del
        editor queda flotando fuera de su caja (feedback 2026-09-12).
      */}
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 p-2.5 lg:flex-row lg:overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[18px] border border-border bg-surface">

      {/* Cabecera: título, breadcrumb, versión y estado de guardado */}
      <header className="flex flex-none flex-wrap items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2 print:hidden">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <FileText size={16} className="shrink-0 text-text-muted" aria-hidden />
          <input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            aria-label="Título del documento"
            className="min-w-0 flex-1 rounded-[var(--radius-input)] border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium text-text hover:border-border focus:border-border focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">

          <span
            role="status"
            aria-live="polite"
            className={cn(
              "inline-flex items-center gap-1 text-[11px]",
              guardado.tipo === "error" || guardado.tipo === "conflicto" || guardado.tipo === "validada" ? "text-error" : "text-text-subtle",
            )}
          >
            {guardado.tipo === "guardando" && (
              <>
                <Loader2 size={11} className="animate-spin" aria-hidden /> Guardando…
              </>
            )}
            {guardado.tipo === "guardado" && (
              <>
                <Check size={11} aria-hidden /> Guardado {guardado.hora}
              </>
            )}
            {guardado.tipo === "conflicto" && (
              <>
                <AlertTriangle size={11} aria-hidden /> Conflicto: el reporte está en la v{guardado.versionActual}. Tu borrador
                se conserva.
              </>
            )}
            {guardado.tipo === "validada" && (
              <>
                <AlertTriangle size={11} aria-hidden /> La v{guardado.versionActual} está validada y no se sobrescribe. Pide el
                cambio en el chat y usa Aplicar para crear una versión nueva.
              </>
            )}
            {guardado.tipo === "error" && (
              <>
                <AlertTriangle size={11} aria-hidden /> {guardado.mensaje}
              </>
            )}
          </span>

          <button
            type="button"
            onClick={() => {
              setHistorialAbierto(true);
              void cargarHistorial();
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-input)] border border-border bg-surface px-2.5 text-xs text-text hover:bg-surface-hover"
          >
            <History size={14} aria-hidden /> Historial
          </button>
          <DescargasExpediente casoId={casoId} version={version} />
        </div>
      </header>

      {/* Menú Archivo/Editar/Ver/Insertar/Formato */}
      <div className="flex flex-none flex-wrap items-center gap-0.5 border-b border-border bg-surface px-2 py-1 text-xs print:hidden">
        {[
          {
            etiqueta: "Archivo",
            opciones: [
              { texto: "Guardar ahora (Cmd/Ctrl+S)", accion: () => void guardar(documentoActual) },
              { texto: "Imprimir / PDF", accion: () => window.print() },
            ],
          },
          {
            etiqueta: "Editar",
            opciones: [
              { texto: "Deshacer", accion: () => editor?.chain().focus().undo().run() },
              { texto: "Rehacer", accion: () => editor?.chain().focus().redo().run() },
              { texto: "Seleccionar todo", accion: () => editor?.chain().focus().selectAll().run() },
            ],
          },
          {
            etiqueta: "Ver",
            opciones: [
              ...ZOOMS.map((z) => ({ texto: `Zoom ${z}%`, accion: () => setZoom(z) })),
              { texto: "Ajustar ancho", accion: () => setZoom("ancho") },
            ],
          },
          {
            etiqueta: "Insertar",
            opciones: [
              { texto: "Tabla 3×3", accion: () => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
              { texto: "Línea horizontal", accion: () => editor?.chain().focus().setHorizontalRule().run() },
              { texto: "Cita en bloque", accion: () => editor?.chain().focus().toggleBlockquote().run() },
            ],
          },
          {
            etiqueta: "Formato",
            opciones: [
              { texto: "Negrita", accion: () => editor?.chain().focus().toggleBold().run() },
              { texto: "Cursiva", accion: () => editor?.chain().focus().toggleItalic().run() },
              { texto: "Quitar formato", accion: () => editor?.chain().focus().unsetAllMarks().run() },
            ],
          },
        ].map((menu) => (
          <DropdownMenu.Root key={menu.etiqueta}>
            <DropdownMenu.Trigger asChild>
              <button type="button" className="rounded-[var(--radius-input)] px-2 py-1 text-text-muted hover:bg-surface-hover hover:text-text">
                {menu.etiqueta}
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="start"
                sideOffset={4}
                className="z-50 min-w-[190px] rounded-[var(--radius-card)] border border-border bg-surface p-1 shadow-lg"
              >
                {menu.opciones.map((opcion) => (
                  <DropdownMenu.Item
                    key={opcion.texto}
                    onSelect={opcion.accion}
                    className="cursor-pointer rounded-md px-2 py-1.5 text-text outline-none hover:bg-surface-hover focus:bg-surface-hover"
                  >
                    {opcion.texto}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        ))}

        <span className="mx-1 h-4 w-px bg-border" aria-hidden />

        <div className="inline-flex rounded-[var(--radius-input)] border border-border p-0.5" role="group" aria-label="Modo de edición">
          {(["editar", "sugerir", "lectura"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setModo(m)}
              aria-pressed={modo === m}
              className={cn("rounded-[6px] px-2 py-0.5 capitalize", modo === m ? "bg-surface-muted text-text" : "text-text-muted")}
            >
              {m}
            </button>
          ))}
        </div>

        <select
          aria-label="Zoom"
          value={String(zoom)}
          onChange={(e) => setZoom(e.target.value === "ancho" ? "ancho" : Number(e.target.value))}
          className="ml-1 h-7 rounded-[var(--radius-input)] border border-border bg-surface px-1.5 text-xs text-text"
        >
          {ZOOMS.map((z) => (
            <option key={z} value={z}>
              {z}%
            </option>
          ))}
          <option value="ancho">Ajustar ancho</option>
        </select>

        <span
          className={cn(
            "ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
            citas.revisarCitas ? "border-error/40 bg-error/5 text-error" : "border-border bg-surface-muted text-text-muted",
          )}
          data-testid="estado-citas"
        >
          {citas.revisarCitas ? (
            <>
              <AlertTriangle size={11} aria-hidden /> Revisar citas ({citas.invalidas.length}) · no publicable
            </>
          ) : (
            <>
              <Check size={11} aria-hidden /> {citas.total} citas con evidencia validada
            </>
          )}
        </span>
      </div>

      <EditorToolbar editor={editor} deshabilitado={modo !== "editar"} />

      {modo === "sugerir" && (
        <p className="flex-none border-b border-border bg-surface-muted px-3 py-1.5 text-[11px] text-text-muted print:hidden">
          Modo sugerir: el documento no se edita a mano. Selecciona texto y pide el cambio en el chat; llega como propuesta con
          diff y solo &quot;Aplicar&quot; crea versión.
        </p>
      )}

      {/*
        Cuerpo: índice + hoja viven juntos en un solo bloque contenedor
        (mismo patrón que `InvestigacionVista`: `rounded-[18px] border
        border-border bg-surface`), y el chat de IA queda aparte, como bloque
        propio — a pedido del usuario (2026-09-12): antes los tres eran
        hermanos sueltos en la misma fila y no se distinguía "el documento"
        de "el chat".
      */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="shrink-0 overflow-y-auto border-b border-border px-2 py-2 lg:w-[220px] lg:border-b-0 lg:border-r">
            <IndiceSecciones entradas={indice} activa={seleccion?.block_ids[0]} onIr={irABloque} />
          </div>

          <div ref={lienzoRef} className="lienzo-editor min-w-0 flex-1 overflow-auto bg-app-bg p-4 sm:p-8">
            <div
              className="zoom-hoja mx-auto"
              style={{
                width: zoom === "ancho" ? "100%" : 794 * escala,
                maxWidth: "100%",
              }}
            >
              <div
                className="hoja-a4 mx-auto max-w-full"
                style={zoom === "ancho" ? { width: "100%", minWidth: 0 } : { transform: `scale(${escala})`, transformOrigin: "top left" }}
              >
                {editor ? (
                  <EditorContent editor={editor} />
                ) : (
                  <p className="text-sm text-text-subtle">Cargando el documento…</p>
                )}
              </div>
            </div>
          </div>
          </div>
        </div>

        {/*
          Chat de IA: misma columna que en `/documentos/[id]` —sin caja ni
          borde propios, fondo transparente y 268 px a la derecha (feedback
          2026-09-12). El selector de ancho se va con ella.
        */}
        <div className="flex w-full shrink-0 flex-col overflow-hidden bg-transparent max-lg:h-[520px] lg:w-[268px] lg:self-stretch lg:pl-3.5">
          <div className="min-h-0 flex-1 overflow-hidden">
            <ReportChat
              casoId={casoId}
              version={version}
              seleccion={seleccion}
              evidencia={evidencia}
              origen={origen}
              modoLectura={modo === "lectura"}
              onAplicado={adoptarVersion}
              onLimpiarSeleccion={() => setSeleccion(null)}
              onAbrirCita={abrirCita}
            />
          </div>
        </div>
      </div>

      <CitaDrawer
        referencia={citaAbierta}
        // Una fila de evidencia puede producir varias referencias: se busca en
        // todas, no solo en la principal, o el drawer contradiría al chip verde.
        evidencia={evidencia.find((e) => citaAbierta !== null && e.referencias.includes(citaAbierta)) ?? null}
        onOpenChange={(abierto) => !abierto && setCitaAbierta(null)}
      />

      <Dialog.Root open={historialAbierto} onOpenChange={setHistorialAbierto}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/20" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[min(900px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 overflow-auto rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-xl">
            <Dialog.Title className="text-sm font-semibold text-text">Historial de versiones</Dialog.Title>
            <Dialog.Description className="text-xs text-text-subtle">
              Revertir no borra nada: copia la versión elegida a una versión nueva (07 §4, 09 §8).
            </Dialog.Description>

            <ul className="flex flex-col gap-1">
              {historial.map((v) => (
                <li key={v.version} className="flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-border px-3 py-2 text-xs">
                  <span className="font-medium text-text">v{v.version}</span>
                  <span className="text-text-muted">{v.autor}</span>
                  <span className="text-text-subtle">{v.estado_revision}</span>
                  <span className="text-text-subtle">{v.creado}</span>
                  <span className="ml-auto flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setComparando(v.version)}
                      className="rounded-[var(--radius-input)] border border-border px-2 py-0.5 text-text-muted hover:bg-surface-hover"
                    >
                      Comparar
                    </button>
                    <button
                      type="button"
                      disabled={v.version === version}
                      onClick={() => void revertir(v.version)}
                      className="inline-flex items-center gap-1 rounded-[var(--radius-input)] border border-border px-2 py-0.5 text-text-muted hover:bg-surface-hover disabled:opacity-40"
                    >
                      <RotateCcw size={11} aria-hidden /> Revertir
                    </button>
                  </span>
                </li>
              ))}
              {historial.length === 0 && <li className="text-xs text-text-subtle">Sin versiones cargadas.</li>}
            </ul>

            {comparando !== null && historial.length > 1 && (
              <VersionDiff
                titulo={`Diferencias v${comparando} → v${version}`}
                diff={diffSimple(
                  historial.find((v) => v.version === comparando)?.markdown ?? "",
                  historial.find((v) => v.version === version)?.markdown ?? "",
                )}
                maxAltura={320}
              />
            )}

            <Dialog.Close className="self-end rounded-[var(--radius-input)] border border-border px-3 py-1 text-xs text-text-muted hover:bg-surface-hover">
              Cerrar
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

/**
 * Diff de historial línea a línea. Es presentación: el diff normativo de una
 * propuesta lo calcula el BFF con `diff` sobre el Markdown derivado.
 */
function diffSimple(antes: string, despues: string): string {
  const a = antes.split("\n");
  const b = despues.split("\n");
  const salida: string[] = [`--- v anterior`, `+++ v actual`];
  const maximo = Math.max(a.length, b.length);
  for (let i = 0; i < maximo; i += 1) {
    if (a[i] === b[i]) {
      if (a[i] !== undefined) salida.push(` ${a[i]}`);
      continue;
    }
    if (a[i] !== undefined) salida.push(`-${a[i]}`);
    if (b[i] !== undefined) salida.push(`+${b[i]}`);
  }
  return salida.join("\n");
}
