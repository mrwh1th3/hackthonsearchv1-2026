// n8n/runtime/loop.mjs — bucle explícito de Messages (17 §5).
//
// No es un nodo AI Agent opaco: cada petición al modelo y cada herramienta se
// reservan en ledger/presupuesto, se registran en bitácora y dejan checkpoint.
// En n8n cada vuelta del bucle es una EJECUCIÓN acotada (un request de modelo
// o un lote de herramientas) que guarda y termina; aquí el bucle se recorre en
// proceso para poder probar el protocolo completo sin red.
//
// Dependencias inyectadas (sin red, sin DB):
//   enviar({url, headers, body, deadline_at})  → {status, headers, body} | {tipo:'timeout'}
//   ejecutarHerramienta({nombre, argumentos, p_operacion, contexto}) → envelope de 06
//   registrar(evento)                          → escritura en bitácora
//
// Reglas duras que el bucle hace cumplir:
//   - Un `tool_result` por cada `tool_use_id`, en orden, sin texto previo.
//   - Repetir el transporte no repite la herramienta ni consume cuota.
//   - Una sola reparación de JSON, que también consume request.
//   - `max_tokens` no se persiste como informe válido.
//   - Herramienta fuera del allowlist del rol = error tipificado, no ejecución.

import {
  URL_MENSAJES, construirCuerpo, construirHeaders, construirMensajeReparacion,
  construirMensajeToolResults, herramientasPermitidas, mensajeContexto, parsearRespuesta,
} from './provider/messages.mjs';
import { MAX_REPARACIONES_JSON } from './config.mjs';
import { aDTO, avanzar, esTerminal, nuevoEstadoInterno } from './checkpoint.mjs';
import { uuidDeterminista } from './ledger.mjs';
import { enviarConReintentos } from './transporte.mjs';

const MAX_VUELTAS = 32;

export async function correrBucle({
  contexto,
  prompts,
  ledger,
  presupuesto,
  enviar,
  ejecutarHerramienta,
  headers = { 'content-type': 'application/json', 'x-api-key': '[inyectado]', 'anthropic-version': '[inyectado]' },
  almacen = null,
  registrar = () => {},
  ahora = () => Date.now(),
  dormir = async () => {},
  aleatorio = () => 0.5,
  max_vueltas = MAX_VUELTAS,
}) {
  const rol = contexto.rol;
  let interno = nuevoEstadoInterno({
    execution_id: contexto.execution_id,
    caso_id: contexto.caso_id,
    tarea_id: contexto.tarea_id,
    editor_operacion_id: contexto.editor_operacion_id,
    rol,
    context_hash: contexto.context_hash,
    prompt_hash: contexto.prompt_hash,
    deadline_at: contexto.limites.deadline_at,
    ronda: contexto.ronda,
    intento: contexto.intento,
    version_contexto: contexto.version_contexto,
    fencing_token: contexto.fencing_token ?? '1',
  });
  interno.mensajes = [mensajeContexto(contexto)];
  let colaPendiente = [];
  let motivoRequest = 'turno';
  const limite = Date.parse(contexto.limites.deadline_at);

  const guardar = () => {
    if (!almacen) return { ok: true };
    const resultado = almacen.guardar({
      caso_id: interno.caso_id,
      paso: interno.paso,
      fencing_token: interno.fencing_token,
      revision_esperada: interno.revision,
      checkpoint: aDTO(interno),
      ahora: ahora(),
    });
    if (resultado.ok) interno.revision = resultado.revision;
    return resultado;
  };

  for (let vuelta = 0; vuelta < max_vueltas; vuelta += 1) {
    if (esTerminal(interno.estado_interno)) break;
    if (ahora() >= limite && interno.estado_interno !== 'preparar_contexto') {
      interno = avanzar(interno, 'deadline');
      registrar({ tipo_evento: 'paso_timeout', payload: { estado: interno.estado_interno, rol } });
      guardar();
      break;
    }

    switch (interno.estado_interno) {
      case 'preparar_contexto': {
        registrar({ tipo_evento: 'contexto_preparado', payload: { rol, context_hash: interno.context_hash, ronda: contexto.ronda } });
        interno = avanzar(interno, 'contexto_listo');
        guardar();
        break;
      }

      case 'solicitar_modelo': {
        const reserva = presupuesto.reservarRequest({ rol, motivo: motivoRequest });
        if (!reserva.ok) {
          interno = avanzar(interno, 'sin_presupuesto');
          interno.diagnostico = reserva.error;
          registrar({ tipo_evento: 'presupuesto_agotado', payload: { recurso: 'requests', rol } });
          guardar();
          break;
        }
        const request_id = uuidDeterminista('request', interno.execution_id, interno.paso, motivoRequest);
        interno.request_id_actual = request_id;
        ledger.reservarRequest({ execution_id: interno.execution_id, request_id, paso: interno.paso, rol, motivo: motivoRequest });
        const cuerpo = construirCuerpo({
          contexto,
          prompts,
          mensajes: interno.mensajes,
          sin_herramientas: motivoRequest === 'reparacion',
        });
        registrar({ tipo_evento: 'llm_request', payload: { request_id, rol, motivo: motivoRequest, herramientas: cuerpo.tools?.length ?? 0, modelo: cuerpo.model } });
        const envio = await enviarConReintentos({
          ejecutar: () => enviar({ url: URL_MENSAJES, headers, body: cuerpo, deadline_at: interno.deadline_at }),
          deadline_at: interno.deadline_at,
          ahora, dormir, aleatorio,
          alIntentar: () => { ledger.registrarIntentoTransporte(request_id); interno.intentos_transporte += 1; },
        });
        motivoRequest = 'turno';

        if (envio.estado === 'desconocido') {
          ledger.marcarDesconocido(request_id, { motivo: envio.error.codigo });
          interno = avanzar(interno, 'ambiguo');
          interno.diagnostico = envio.error;
          registrar({ tipo_evento: 'llm_ambiguo', payload: { request_id, error: envio.error } });
          guardar();
          break;
        }
        if (!envio.ok) {
          ledger.marcarErrorRequest(request_id, envio.error);
          const evento = envio.error.codigo === 'deadline_excedido' ? 'deadline'
            : envio.error.reintentable ? 'reintentable' : 'ambiguo';
          interno = avanzar(interno, evento);
          interno.diagnostico = envio.error;
          registrar({ tipo_evento: 'llm_error', payload: { request_id, error: envio.error, intentos: envio.intentos } });
          guardar();
          break;
        }

        const analisis = parsearRespuesta(envio.respuesta, { rol });
        ledger.completarRequest(request_id, {
          provider_request_id: analisis.provider_request_id,
          usage: analisis.usage,
          modelo: analisis.modelo,
        });
        registrar({
          tipo_evento: 'llm_respuesta',
          payload: { request_id, stop_reason: analisis.stop_reason, tipo: analisis.tipo, usage: analisis.usage ?? null },
        });

        if (analisis.tipo === 'tool_use') {
          interno.mensajes = [...interno.mensajes, { role: 'assistant', content: analisis.bloques_assistant }];
          colaPendiente = analisis.cola;
          interno.pending_tool_use_ids = colaPendiente.map((t) => t.tool_use_id);
          interno = avanzar(interno, 'tool_use');
          guardar();
          break;
        }
        if (analisis.tipo === 'incompleto') {
          // 17 §7: salida incompleta jamás se persiste como informe válido.
          // Una reparación acotada si queda presupuesto de reparación; si no,
          // error visible con diagnóstico (no se reintenta en bucle).
          const quedaReparacion = interno.reparaciones_json < MAX_REPARACIONES_JSON;
          interno.salida_valida = null;
          interno.ultima_salida_texto = analisis.bloques_assistant?.map((b) => b.text ?? '').join('\n') ?? '';
          interno.errores_validacion = [];
          interno.diagnostico = {
            codigo: 'max_tokens',
            mensaje: analisis.diagnostico,
            reintentable: quedaReparacion,
          };
          if (!quedaReparacion) {
            registrar({
              tipo_evento: 'salida_invalida',
              payload: { rol, motivo: 'max_tokens', reparaciones: interno.reparaciones_json },
            });
          }
          interno = avanzar(interno, quedaReparacion ? 'max_tokens' : 'max_tokens_agotado');
          guardar();
          break;
        }
        if (analisis.tipo === 'refusal' || analisis.tipo === 'stop_desconocido') {
          interno.diagnostico = { codigo: analisis.tipo, mensaje: analisis.diagnostico, reintentable: false };
          interno = avanzar(interno, analisis.tipo === 'refusal' ? 'refusal' : 'refusal');
          registrar({ tipo_evento: 'llm_rechazo', payload: { request_id, tipo: analisis.tipo } });
          guardar();
          break;
        }
        // end_turn: parseo y validación por rol.
        interno.salida_valida = analisis.tipo === 'salida_valida' ? analisis.salida : null;
        interno.ultima_salida_texto = analisis.texto ?? null;
        interno.errores_validacion = analisis.errores ?? [];
        interno.contrato = analisis.contrato ?? null;
        interno = avanzar(interno, 'end_turn');
        guardar();
        break;
      }

      case 'ejecutar_herramienta': {
        const permitidas = new Set(herramientasPermitidas(rol, { ronda: contexto.ronda, intento: contexto.intento }));
        const resultados = [];
        for (const llamada of colaPendiente) {
          const claim = ledger.reclamarTool({
            execution_id: interno.execution_id,
            tarea_id: interno.tarea_id ?? interno.execution_id,
            paso: interno.paso,
            request_id: interno.request_id_actual,
            tool_use_id: llamada.tool_use_id,
            nombre: llamada.nombre,
            argumentos: llamada.argumentos,
          });
          if (!claim.nuevo) {
            // Reentrega del mismo tool_use_id: resultado registrado, sin cuota ni mutación nueva.
            resultados.push({
              tool_use_id: llamada.tool_use_id,
              resultado: claim.registro.resultado,
              error: claim.registro.error,
            });
            registrar({ tipo_evento: 'tool_reentrega', payload: { tool_use_id: llamada.tool_use_id, p_operacion: claim.operacion_id } });
            continue;
          }
          if (!permitidas.has(llamada.nombre)) {
            const error = { codigo: 'argumento_invalido', mensaje: `herramienta no permitida para el rol ${rol}: ${llamada.nombre}`, reintentable: false };
            ledger.errorTool({ request_id: interno.request_id_actual, tool_use_id: llamada.tool_use_id }, error);
            resultados.push({ tool_use_id: llamada.tool_use_id, error });
            registrar({ tipo_evento: 'tool_denegada', payload: { tool_use_id: llamada.tool_use_id, herramienta: llamada.nombre, rol } });
            continue;
          }
          const reserva = presupuesto.reservarTool({
            rol, ronda: contexto.ronda, tarea_id: interno.tarea_id, intento: contexto.intento, version_contexto: contexto.version_contexto,
          });
          if (!reserva.ok) {
            ledger.errorTool({ request_id: interno.request_id_actual, tool_use_id: llamada.tool_use_id }, reserva.error);
            resultados.push({ tool_use_id: llamada.tool_use_id, error: reserva.error });
            registrar({ tipo_evento: 'presupuesto_agotado', payload: { recurso: 'tools', rol, herramienta: llamada.nombre } });
            continue;
          }
          let envelope;
          try {
            envelope = await ejecutarHerramienta({
              nombre: llamada.nombre,
              argumentos: llamada.argumentos,
              p_operacion: claim.operacion_id,
              contexto,
            });
          } catch (err) {
            envelope = { ok: false, error: { codigo: 'fallo_transitorio', mensaje: err?.message ?? String(err), reintentable: true } };
          }
          if (envelope?.ok === false) {
            ledger.errorTool({ request_id: interno.request_id_actual, tool_use_id: llamada.tool_use_id }, envelope.error);
            resultados.push({ tool_use_id: llamada.tool_use_id, error: envelope.error });
          } else {
            ledger.completarTool({ request_id: interno.request_id_actual, tool_use_id: llamada.tool_use_id }, {
              resultado: envelope, cache_hit: Boolean(envelope?.cache_hit),
            });
            resultados.push({ tool_use_id: llamada.tool_use_id, resultado: envelope });
          }
          registrar({
            tipo_evento: 'tool_resumen',
            payload: { tool_use_id: llamada.tool_use_id, herramienta: llamada.nombre, p_operacion: claim.operacion_id, ok: envelope?.ok !== false },
          });
        }
        interno.mensajes = [...interno.mensajes, construirMensajeToolResults(colaPendiente, resultados)];
        colaPendiente = [];
        interno.pending_tool_use_ids = [];
        interno = avanzar(interno, 'resultados_listos');
        guardar();
        break;
      }

      case 'validar_salida': {
        if (interno.salida_valida) {
          interno = avanzar(interno, 'valida');
          registrar({ tipo_evento: 'salida_validada', payload: { rol, contrato: interno.contrato } });
          guardar();
          break;
        }
        if (interno.reparaciones_json < MAX_REPARACIONES_JSON) {
          interno = avanzar(interno, 'invalida');
        } else {
          interno = avanzar(interno, 'sin_reparacion');
          interno.diagnostico = interno.diagnostico ?? { codigo: 'salida_invalida', mensaje: 'la reparación tampoco validó', reintentable: false };
          registrar({ tipo_evento: 'salida_invalida', payload: { rol, errores: (interno.errores_validacion ?? []).length } });
        }
        guardar();
        break;
      }

      case 'reparar_json': {
        interno.mensajes = [...interno.mensajes, construirMensajeReparacion({
          salida_anterior: interno.ultima_salida_texto,
          errores: interno.errores_validacion,
          contrato: interno.contrato ?? '(contrato del rol)',
        })];
        interno.reparaciones_json += 1;
        motivoRequest = 'reparacion';
        registrar({ tipo_evento: 'reparacion_json', payload: { rol, intento: interno.reparaciones_json } });
        interno = avanzar(interno, 'reparacion_preparada');
        guardar();
        break;
      }

      case 'espera_reintento': {
        // El dispatcher puede reprogramar el paso; el bucle en proceso no espera
        // indefinidamente: agota y deja estado terminal con diagnóstico.
        interno = avanzar(interno, 'agotado');
        registrar({ tipo_evento: 'transporte_agotado', payload: { rol, diagnostico: interno.diagnostico } });
        guardar();
        break;
      }

      default:
        throw new Error(`estado interno no manejado: ${interno.estado_interno}`);
    }
  }

  return {
    estado_interno: interno.estado_interno,
    salida: interno.estado_interno === 'terminado' ? interno.salida_valida : null,
    diagnostico: interno.diagnostico ?? null,
    checkpoint: aDTO(interno),
    interno,
    presupuesto: presupuesto.instantanea(),
    ledger: ledger.resumen(),
  };
}
