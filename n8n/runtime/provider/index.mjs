// n8n/runtime/provider/index.mjs — interfaz común del adapter de proveedor (20).
//
// Decisión H0 del coordinador (21 §5): se implementa SOLO `messages_api`.
// `claude_code_actions` queda como interfaz declarada y fallback documentado;
// no se construyen dos runtimes. Llamarlo lanza un error tipificado en vez de
// degradar silenciosamente a otro perfil.

import { PROVEEDOR } from '../config.mjs';
import * as messages from './messages.mjs';

export const PROVEEDORES = Object.freeze(['messages_api', 'claude_code_actions']);

/**
 * Contrato del adapter (20): recibe `{execution_id, context_ref, prompt_hash,
 * role, deadline_at}` y devuelve una aceptación con ID de proveedor.
 * Nunca recibe ni devuelve teléfono, secretos ni el expediente.
 */
export function crearAdaptador(proveedor = PROVEEDOR) {
  if (proveedor === 'messages_api') {
    return {
      nombre: 'messages_api',
      budget_enforcement: 'requests_and_tools',
      aceptarSolicitud: messages.aceptarSolicitud,
      construirCuerpo: messages.construirCuerpo,
      construirHeaders: messages.construirHeaders,
      parsearRespuesta: messages.parsearRespuesta,
      construirMensajeToolResults: messages.construirMensajeToolResults,
      construirMensajeReparacion: messages.construirMensajeReparacion,
      url: messages.URL_MENSAJES,
    };
  }
  if (proveedor === 'claude_code_actions') {
    const noImplementado = () => {
      const error = new Error(
        'perfil claude_code_actions no implementado: decisión H0 (21 §5) eligió messages_api; '
        + 'este perfil no observa requests por HTTP (budget_enforcement=tools_and_turns) y requiere gate explícito de 20.',
      );
      error.codigo = 'proveedor_no_implementado';
      throw error;
    };
    return {
      nombre: 'claude_code_actions',
      budget_enforcement: 'tools_and_turns',
      aceptarSolicitud: noImplementado,
      construirCuerpo: noImplementado,
      construirHeaders: noImplementado,
      parsearRespuesta: noImplementado,
      construirMensajeToolResults: noImplementado,
      construirMensajeReparacion: noImplementado,
      url: null,
    };
  }
  const error = new Error(`proveedor desconocido: ${proveedor}`);
  error.codigo = 'proveedor_desconocido';
  throw error;
}
