import type { CasoDetalle } from "@/lib/data/source";
import type { EventoForense, Familia, Nivel, PistaCodigo } from "@/lib/data/types";

/**
 * Traduce la bitácora técnica de un caso a una línea de tiempo de decisiones
 * en lenguaje llano, para un auditor que no conoce el sistema.
 *
 * Determinista y sin LLM (CLAUDE.md regla 4): cada frase se arma con datos ya
 * persistidos — la bitácora (regla 2), las pistas, las notas de los
 * especialistas, la defensa, la réplica y el dictamen. Si un evento no tiene
 * traducción clara o es mecánica interna (checkpoints, reintentos de
 * transporte, validación de JSON), no se muestra: no aporta a "qué se decidió".
 */

export type Tono = "normal" | "alerta" | "descarte" | "conclusion";

export interface PasoNarrado {
  id: string;
  ts: string;
  titulo: string;
  detalle?: string;
  tono: Tono;
}

/** Nombre llano y qué revisa cada pista (docs/02-factores-correlaciones.md). */
export const PISTA_LLANA: Record<PistaCodigo, { nombre: string; revisa: string }> = {
  D1: { nombre: "Lo que factura no coincide con su giro", revisa: "si lo que factura corresponde a la actividad que tiene registrada ante el SAT" },
  D2: { nombre: "Capacidad para operar", revisa: "si factura mucho sin tener empleados, compras ni gastos que lo respalden" },
  D3: { nombre: "Montos y conceptos sospechosos", revisa: "si las facturas usan montos redondos o patrones poco naturales" },
  D4: { nombre: "Cancelaciones de facturas", revisa: "si cancela muchas facturas o las cancela en fechas clave" },
  F1: { nombre: "Facturas sin pago en el banco", revisa: "si cada factura cobrada tiene un depósito real que la respalde" },
  F2: { nombre: "Dinero que sólo pasa", revisa: "si el dinero entra y sale casi de inmediato hacia personas o efectivo" },
  F3: { nombre: "Pagos de un tercero", revisa: "si quien paga las facturas es una persona distinta a quien las recibe" },
  F4: { nombre: "Dinero que regresa", revisa: "si el dinero da la vuelta entre cuentas y vuelve a su origen" },
  R1: { nombre: "Datos compartidos con otras empresas", revisa: "si comparte domicilio, representante, teléfono o cuenta con otras empresas" },
  R2: { nombre: "Facturas en círculo o en cadena", revisa: "si las empresas se facturan entre sí en círculo o en cadena" },
  R3: { nombre: "Pocos clientes o proveedores", revisa: "si casi todo su volumen se concentra en muy pocas contrapartes" },
  T1: { nombre: "Vida corta de la empresa", revisa: "si es nueva, factura mucho en poco tiempo y luego deja de operar" },
  T2: { nombre: "Fechas sospechosas", revisa: "si emite muchas facturas casi al mismo tiempo o tiene picos sin historial" },
  E1: { nombre: "Listas del SAT", revisa: "si aparece, o sus contrapartes, en la lista 69-B del SAT" },
};

export const FAMILIA_LLANA: Record<Familia, string> = {
  D: "documentos y facturas",
  F: "dinero y bancos",
  R: "relaciones entre empresas",
  T: "fechas y comportamiento en el tiempo",
  E: "listas oficiales del SAT",
};

export const NIVEL_LLANO: Record<Nivel, { titulo: string; explica: string }> = {
  sin_hallazgos: { titulo: "Sin hallazgos", explica: "No se encontró nada fuera de lo normal." },
  anomalia_explicada: { titulo: "Algo inusual, pero con explicación", explica: "Se vio algo raro, pero hay una razón legítima que lo explica." },
  no_concluyente: { titulo: "No se puede concluir", explica: "Con la información disponible no alcanza para afirmar ni descartar." },
  presuncion: {
    titulo: "Presunción de operaciones simuladas",
    explica: "Hay indicios suficientes para presumir que las operaciones podrían no ser reales. La determinación final corresponde al SAT.",
  },
  presuncion_alta: {
    titulo: "Presunción alta de operaciones simuladas",
    explica: "Hay indicios fuertes y de varias fuentes de que las operaciones podrían no ser reales. La determinación final corresponde al SAT.",
  },
};

const RECURSO: Array<[RegExp, string]> = [
  [/factura|cfdi/i, "las facturas (CFDI)"],
  [/movimiento|banc|flujo/i, "los movimientos bancarios"],
  [/nomina/i, "la nómina"],
  [/69b|lista/i, "las listas del SAT"],
  [/grafo|relacion|vincul|atribut/i, "las relaciones con otras empresas"],
  [/contribuyente|padron|entidad|perfil/i, "los datos del contribuyente en el padrón"],
  [/pago|complemento/i, "los complementos de pago"],
];

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function periodoLlano(texto: string): string {
  const m = texto.match(/periodo\s*=\s*(\d{4})-(\d{2})/i);
  if (!m) return "";
  return ` de ${MESES[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

function recursoLlano(texto: string): string {
  const fn = texto.match(/forense_([a-z0-9_]+)/i)?.[1] ?? texto;
  return RECURSO.find(([re]) => re.test(fn))?.[1] ?? "información del contribuyente";
}

function hallazgosLlanos(texto: string): string | undefined {
  const m = texto.match(/(\d+)\s+(CFDI|facturas?|movimientos?|cuentas?|contribuyentes?|RFC|registros?)/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  const tipo = m[2].toLowerCase();
  const nombre = tipo.startsWith("cfdi") || tipo.startsWith("factura") ? "factura" : tipo.startsWith("movimiento") ? "movimiento" : tipo.startsWith("cuenta") ? "cuenta" : tipo.startsWith("registro") ? "registro" : "contribuyente";
  if (n === 0) return `No se encontró ningún${nombre === "factura" || nombre === "cuenta" ? "a" : ""} ${nombre}.`;
  return `Se encontr${n === 1 ? "ó" : "aron"} ${n} ${nombre}${n === 1 ? "" : "s"}.`;
}

const RESULTADO_DEFENSA: Record<string, string> = {
  refuta: "sí lo explica",
  parcial: "lo explica sólo en parte",
  no_refuta: "no lo explica",
};

function capitalizar(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function narrarInvestigacion(eventos: EventoForense[], detalle: CasoDetalle): PasoNarrado[] {
  const { caso, pistas, senales, defensa, replica, dictamen } = detalle;
  const pasos: PasoNarrado[] = [];
  const orden = [...eventos].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0) || new Date(a.ts).getTime() - new Date(b.ts).getTime());
  const resultadoPorOperacion = new Map(
    orden.filter((e) => e.tipo_evento === "tool_result" && e.payload.operacion_id).map((e) => [e.payload.operacion_id as string, e]),
  );
  const consumidos = new Set<string>();
  let ronda = 0;
  let senalIdx = 0;

  const add = (e: EventoForense, titulo: string, tono: Tono = "normal", det?: string) =>
    pasos.push({ id: e.id, ts: e.ts, titulo, detalle: det, tono });

  for (const e of orden) {
    if (consumidos.has(e.id)) continue;
    const texto = e.payload.resumen ?? "";

    switch (e.tipo_evento) {
      case "caso_creado":
      case "cluster_armado": {
        const criterios = [...pistas]
          .sort((a, b) => b.score - a.score)
          .map((p) => `${PISTA_LLANA[p.codigo]?.nombre ?? p.codigo}: se revisa ${PISTA_LLANA[p.codigo]?.revisa ?? p.resumen}.`);
        const vinculados = caso.rfcs_satelite.length > 0 ? ` junto con ${caso.rfcs_satelite.length} contribuyente${caso.rfcs_satelite.length === 1 ? "" : "s"} vinculado${caso.rfcs_satelite.length === 1 ? "" : "s"}` : "";
        add(
          e,
          `Se abrió la revisión de ${caso.rfc_principal}${vinculados}`,
          "alerta",
          criterios.length > 0 ? `Se eligió por estas señales de alerta:\n${criterios.join("\n")}` : undefined,
        );
        break;
      }
      case "cluster_expandido":
        add(e, "Se amplió la revisión a más empresas relacionadas");
        break;
      case "ronda_inicio":
        ronda += 1;
        add(
          e,
          ronda === 1 ? "Empezó el análisis de los especialistas" : `Empezó una ${ronda}ª vuelta de análisis`,
          "normal",
          "Revisan documentos y facturas, dinero y bancos, relaciones entre empresas, fechas y listas del SAT.",
        );
        break;
      case "tool_call": {
        const resultado = e.payload.operacion_id ? resultadoPorOperacion.get(e.payload.operacion_id) : undefined;
        if (resultado) consumidos.add(resultado.id);
        add(e, `Se revisaron ${recursoLlano(texto)}${periodoLlano(texto)}`, "normal", resultado ? hallazgosLlanos(resultado.payload.resumen) : undefined);
        break;
      }
      case "tool_result": {
        const encontrado = hallazgosLlanos(texto);
        if (encontrado) add(e, "Se obtuvo el resultado de una consulta", "normal", encontrado);
        break;
      }
      case "tool_denegada":
        add(e, "Una consulta se bloqueó por estar fuera del alcance del caso", "descarte");
        break;
      case "senal_escrita": {
        const s = senales[senalIdx++];
        if (s) {
          add(
            e,
            s.refuta ? `El especialista en ${FAMILIA_LLANA[s.familia]} descartó una sospecha` : `El especialista en ${FAMILIA_LLANA[s.familia]} encontró algo`,
            s.refuta ? "descarte" : "alerta",
            `${s.titular}. Certeza: ${s.confianza}.`,
          );
        } else {
          const m = texto.match(/^([DFRTE])\b.*?\b([DFRTE]\d)\b/);
          const fam = m?.[1] as Familia | undefined;
          const pista = m?.[2] as PistaCodigo | undefined;
          add(
            e,
            fam ? `El especialista en ${FAMILIA_LLANA[fam]} encontró algo` : "Un especialista registró un hallazgo",
            "alerta",
            pista && PISTA_LLANA[pista] ? `Relacionado con: ${PISTA_LLANA[pista].nombre.toLowerCase()}.` : undefined,
          );
        }
        break;
      }
      case "despertar": {
        const m = texto.match(/\b([DFRTE]\d)\b.*?\ba\s+([DFRTE])\b/);
        const pista = m?.[1] as PistaCodigo | undefined;
        const fam = m?.[2] as Familia | undefined;
        add(
          e,
          fam ? `Se pidió la opinión del especialista en ${FAMILIA_LLANA[fam]}` : "Se pidió la opinión de otro especialista",
          "normal",
          pista && PISTA_LLANA[pista] ? `Lo encontrado sobre "${PISTA_LLANA[pista].nombre.toLowerCase()}" requería confirmarse desde otro ángulo.` : undefined,
        );
        break;
      }
      case "ronda_fin":
        add(e, ronda > 1 ? `Terminó la ${ronda}ª vuelta de análisis` : "Terminó el análisis de los especialistas");
        break;
      case "frontera_detectada":
        add(e, "Aparecieron empresas relacionadas fuera del grupo revisado", "alerta");
        break;
      case "evidencia_descartada":
        add(e, "Se descartó una prueba que no se pudo verificar", "descarte");
        break;
      case "defensa_inicio": {
        const lineas = defensa.map((d) => {
          // `pista_objetivo` es el id de la pista (a veces su código).
          const codigo = pistas.find((p) => p.id === d.pista_objetivo)?.codigo ?? (d.pista_objetivo as PistaCodigo);
          const nombre = PISTA_LLANA[codigo]?.nombre ?? "esta señal";
          return `¿"${nombre}" tiene una explicación normal? ${d.argumento} Resultado: ${RESULTADO_DEFENSA[d.resultado] ?? d.resultado}.`;
        });
        add(e, "Se buscaron explicaciones legítimas antes de concluir", "normal", lineas.join("\n") || undefined);
        break;
      }
      case "replica": {
        const lineas = (replica?.resoluciones ?? []).map((r) => `${r.decision === "acepta" ? "Se aceptó" : "No se aceptó"} la explicación: ${r.razon}`);
        const respaldo = texto.includes(":") ? capitalizar(texto.split(":").slice(1).join(":").trim()) : undefined;
        const rechaza = (replica?.resoluciones ?? []).some((r) => r.decision === "rechaza") || /rechaza/i.test(texto);
        add(e, rechaza ? "La explicación no fue suficiente" : "Se evaluó si la explicación era suficiente", rechaza ? "alerta" : "normal", lineas.join("\n") || respaldo);
        break;
      }
      case "auditoria":
        add(e, "Un auditor verificó que cada conclusión tenga pruebas que la respalden");
        break;
      case "reintento_inicio":
        add(e, "Se volvió a intentar la revisión con más información");
        break;
      case "presupuesto_agotado":
        add(e, "Se terminó el tiempo asignado a esta revisión", "descarte", "Con lo reunido hasta ese momento no alcanza para una conclusión más fuerte.");
        break;
      case "inyeccion":
        add(e, "Llegaron datos nuevos y el caso se volvió a revisar", "alerta");
        break;
      case "dictamen": {
        const nivel = dictamen?.nivel ?? caso.nivel;
        if (!nivel) break;
        const fams = (dictamen?.familias ?? caso.familias_confirmadas).map((f) => FAMILIA_LLANA[f]);
        const base = fams.length > 0 ? `Los indicios vienen de ${fams.length} fuente${fams.length === 1 ? "" : "s"} independiente${fams.length === 1 ? "" : "s"}: ${fams.join(" y ")}. ` : "";
        const veredictos = pistas
          .filter((p) => p.evaluacion_caso?.motivo)
          .map((p) => {
            const estado = p.evaluacion_caso!.estado;
            const verbo = estado.startsWith("refutada") ? "se descartó" : estado.includes("parcial") ? "se confirmó en parte" : "se confirmó";
            return `${PISTA_LLANA[p.codigo]?.nombre ?? p.codigo}: ${verbo}. ${p.evaluacion_caso!.motivo}`;
          });
        add(e, `Conclusión: ${NIVEL_LLANO[nivel].titulo}`, "conclusion", [`${base}${NIVEL_LLANO[nivel].explica}`, ...veredictos].join("\n"));
        break;
      }
      default:
        break;
    }
  }
  return pasos;
}
