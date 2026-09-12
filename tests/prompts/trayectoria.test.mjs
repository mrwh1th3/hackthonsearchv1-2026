// Sección 9 del expediente (21 §4): la serie mensual la calcula SQL y el Redactor sólo la
// redacta. Aquí se prueba que el ensamblador la entrega tal cual cuando el paquete la trae
// (contracts 1.2.0, `datos.trayectoria`) y que declara su ausencia como dato positivo cuando
// no la trae, en vez de dejar que el modelo la deduzca del silencio o la invente.

import test from 'node:test';
import assert from 'node:assert/strict';
import { ensamblar, FENCE_INICIO } from '../../n8n/prompts/ensamblar.mjs';
import { fixtureContrato, leerArchivoPrompt, plano } from './ayuda.mjs';

const LITERAL_AUSENTE = 'Serie de trayectoria no disponible en el paquete recibido.';

/** Contenido del mensaje inicial de un rol con el fixture publicado que se indique. */
function contenido(rol, fixture, opciones = {}) {
  return ensamblar(rol, fixtureContrato(fixture), opciones).messages_iniciales[0].content;
}

test('con la serie en el paquete, el Redactor recibe la tabla mensual con eventos y citas', () => {
  const paquete = fixtureContrato('contexto-redactor-trayectoria');
  const serie = paquete.datos.trayectoria;
  assert.ok(Array.isArray(serie) && serie.length > 0, 'el fixture ya no trae trayectoria');

  const texto = contenido('redactor', 'contexto-redactor-trayectoria');
  assert.ok(texto.includes('[TRAYECTORIA meses='), 'falta la cabecera del bloque');
  assert.ok(texto.includes(`[TRAYECTORIA meses=${serie.length} fuente=sql]`));
  assert.ok(
    texto.includes('| mes | facturado | recibido | nomina | n_cfdi | n_movimientos | eventos |'),
    'la serie debe llegar como tabla mensual, no como JSON crudo',
  );

  for (const mes of serie) {
    assert.ok(texto.includes(`| ${mes.mes} |`), `falta el mes ${mes.mes}`);
    // Importes verbatim: la cadena decimal que devolvió SQL, sin formateo de JS.
    for (const importe of [mes.facturado, mes.recibido, mes.nomina]) {
      assert.ok(texto.includes(importe), `${mes.mes}: el importe ${importe} no aparece tal cual`);
    }
    for (const evento of mes.eventos) {
      assert.ok(texto.includes(`${evento.tipo}@${evento.fecha}`), `${mes.mes}: falta ${evento.tipo}`);
      if (evento.referencia) {
        assert.ok(texto.includes(`ref=${evento.referencia}`), `${mes.mes}: falta la cita del evento`);
      }
    }
  }

  // Ningún número se reformatea (nada de separador de miles ni redondeo).
  assert.ok(!/\d,\d{3}/.test(texto), 'algún importe se formateó en vez de copiarse');
  assert.ok(
    plano(texto).includes('no los recalcules ni los redondees'),
    'la instrucción de copiar los números de SQL debe viajar con la tabla (regla 4)',
  );

  // Trayectoria es dato calculado, no texto del contribuyente: no va dentro de un fence.
  const trozo = texto.slice(texto.indexOf('[TRAYECTORIA meses='));
  assert.ok(!trozo.slice(0, 600).includes(FENCE_INICIO), 'la serie no es texto libre');

  // Y cuando sí llega, no se declara ausente.
  assert.ok(!texto.includes('ausente=true'));
  assert.ok(!texto.includes(LITERAL_AUSENTE));
});

test('sin serie en el paquete, el Redactor recibe la ausencia declarada, no el silencio', () => {
  const paquete = fixtureContrato('contexto-redactor');
  assert.equal(paquete.datos.trayectoria, undefined, 'el fixture base no debía traer la serie');

  const texto = contenido('redactor', 'contexto-redactor');
  assert.ok(texto.includes('[TRAYECTORIA ausente=true]'), 'la ausencia debe declararse');
  assert.ok(texto.includes(LITERAL_AUSENTE), 'debe llevar la frase exacta que se escribe en la sección 9');
  assert.ok(
    plano(texto).includes('No la reconstruyas de memoria ni la estimes'),
    'la prohibición de inventar la serie viaja con la declaración',
  );
  assert.ok(!texto.includes('[TRAYECTORIA meses='), 'no puede haber tabla sin serie');
});

test('el prompt del Redactor manda la misma frase exacta que el bloque de ausencia', () => {
  const md = plano(leerArchivoPrompt('redactor.md'));
  assert.ok(md.includes(LITERAL_AUSENTE), 'redactor.md ya no lleva la frase literal');
  assert.ok(md.includes('[TRAYECTORIA meses=… fuente=sql]'), 'redactor.md no nombra el bloque');
});

test('la serie es truncable y, si no cabe, queda listada en el aviso del Redactor', () => {
  // El Redactor no tiene herramientas: un bloque omitido no se recupera. Por eso la serie es
  // lo último que entra y su omisión queda declarada con su ID en el aviso, que es lo que
  // convierte la sección 9 en "no disponible en el paquete recibido" y no en un invento.
  const paquete = fixtureContrato('contexto-redactor-trayectoria');
  const [pieza] = paquete.datos.evidencia;
  const [defensa] = paquete.datos.argumentos;
  const [resolucion] = paquete.datos.resoluciones;
  // Peor caso que admite el contrato: 40 piezas, 40 defensas y sus 40 resoluciones.
  paquete.datos.evidencia = Array.from({ length: 40 }, (_, i) => ({ ...pieza, id: String(900 + i) }));
  paquete.datos.argumentos = Array.from({ length: 40 }, (_, i) => ({ ...defensa, defensa_id: String(800 + i) }));
  paquete.datos.resoluciones = Array.from({ length: 40 }, (_, i) => ({ ...resolucion, defensa_id: String(800 + i) }));

  const r = ensamblar('redactor', paquete);
  assert.equal(r.truncado, true, 'el peor caso del contrato debía truncar');
  assert.ok(r.meta.ids_omitidos.includes('TRAYECTORIA'), `omitidos: ${r.meta.ids_omitidos.join(',')}`);

  const texto = r.messages_iniciales[0].content;
  assert.ok(!texto.includes('[TRAYECTORIA meses='), 'se omitió pero se coló la tabla');
  assert.ok(texto.includes('### AVISO DE TRUNCADO'));
  assert.ok(texto.includes('TRAYECTORIA'), 'el aviso no lista la serie omitida');
  assert.ok(texto.includes('cobertura_incompleta'), 'sin herramientas, la limitación se declara');
  assert.ok(r.meta.caracteres_paquete <= r.meta.techo_caracteres);
});

test('los demás roles de cierre reciben la serie si la traen, y nadie más declara su ausencia', () => {
  // El contrato deja `trayectoria` opcional en todos los paquetes de cierre: si llega, se
  // rinde igual. La declaración de ausencia es sólo del Redactor, que es quien firma la
  // sección 9; al Auditor no se le ocupa presupuesto con un bloque que no le toca.
  const auditor = fixtureContrato('contexto-auditor');
  auditor.datos.trayectoria = fixtureContrato('contexto-redactor-trayectoria').datos.trayectoria;
  const conSerie = ensamblar('auditor', auditor).messages_iniciales[0].content;
  assert.ok(conSerie.includes('[TRAYECTORIA meses='), 'el Auditor no recibió la serie que traía');

  for (const { rol, fixture } of [
    { rol: 'auditor', fixture: 'contexto-auditor' },
    { rol: 'defensor', fixture: 'contexto-defensor' },
    { rol: 'replica', fixture: 'contexto-replica' },
    { rol: 'editor', fixture: 'contexto-editor' },
  ]) {
    const texto = contenido(rol, fixture);
    assert.ok(!texto.includes('[TRAYECTORIA'), `${rol}: no debía llevar bloque de trayectoria`);
  }
});
