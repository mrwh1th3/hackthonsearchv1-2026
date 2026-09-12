# 15 — Webapp: diseño ElevenLabs y editor de reportes

Especificación de diseño e implementación; complementa `09-ui-spec.md` sin eliminar sus vistas ni funcionalidades. Referencia visual solicitada: ElevenLabs, con editor de documento inspirado en Google Docs. Producto y nombre visibles: **Forense**. Los tamaños, tokens y movimientos de este documento son decisiones propuestas para reproducir ese lenguaje visual; no una medición pixel a pixel del dashboard privado.

## 1. Dirección visual y marca

Interfaz clara, monocromática, mucho espacio útil, textos compactos, botones principales negros, paneles blancos y separadores finos. Sidebar estable, encabezados simples y controles de fecha/vista agrupados arriba del contenido. Usar color para datos y estados, no para colorear cada tarjeta.

Referencia: [recursos oficiales de marca de ElevenLabs](https://elevenlabs.io/brand), que presentan variantes monocromas y el símbolo de dos trazos verticales. Adaptar esa economía visual a un símbolo propio de documento de Forense. El dashboard autenticado no se ha inspeccionado; la aceptación visual se hace contra esta especificación y referencias públicas, no contra detalles no observados.

**Logo/favicon:** documento de esquina doblada con dos trazos verticales interiores. Favicon con fondo blanco y documento negro legible a 16 px; variante de marca con documento blanco para botón/cabecera negra. SVG maestro, `favicon.ico` 16/32, `apple-touch-icon.png` 180 y app icons 192/512. Nombre Forense, sin presentar el producto como ElevenLabs. Exportar variantes monocromas; no requiere generación de imagen raster por IA.

## 2. Tokens listos para convertir a CSS variables

Tema claro por defecto. Valores propuestos:

- Superficies: `--app-bg: #FAFAFA`, `--surface: #FFFFFF`, `--surface-muted: #F4F4F5`, `--surface-hover: #ECECEE`.
- Texto: `--text: #18181B`, `--text-muted: #52525B`, `--text-subtle: #71717A`; líneas `--border: #E4E4E7`.
- Acción principal: `--primary: #18181B`, texto blanco, hover `#27272A`. Foco `--focus: #2563EB` con anillo de 2 px y separación de 2 px.
- Estados: correcto `#15803D`, aviso `#A16207`, error `#B91C1C`, información `#1D4ED8`; acompañar siempre con etiqueta/icono.
- Familias: D `#1D4ED8`, F `#0F766E`, R `#7C3AED`, T `#B45309`, E `#BE185D`; mismo mapping en grafo, leyenda, chips, carriles y exportaciones. Fondos tintados suaves; texto de dato mantiene contraste.
- Fuente: Inter o sans del sistema, 14 px/20 de base; títulos 24/32, subtítulos 18/26, etiquetas 12/16. Montos con números tabulares y IDs monoespaciados.
- Espaciado: 4/8/12/16/24/32/48 px. Radios: inputs/botones 8, tarjetas 12, popovers 12, chips redondos. Iconos lineales de 16/18 px con grosor consistente.
- Controles: altura 36 px, compactos 30, CTA de login 44; filas 44–48; objetivo táctil 44 px en móvil. Sombras solo en menús/diálogos, discretas; evitar tarjetas con sombras apiladas.

Comprobar contraste de cada combinación de texto/fondo; no usar color como único indicador de riesgo. El look monocromo prevalece sobre la paleta de series cuando no se está mostrando evidencia.

## 3. Shell de aplicación

- Desktop: sidebar 232 px, compactable a 64; header 60; contenido con padding 24 y ancho útil hasta 1440. Editor usa todo el ancho disponible.
- Sidebar: logo, botón negro **Nueva investigación**, Inicio, Investigaciones, Historial de ejecuciones, Estadísticas, Notificaciones; abajo Perfil y configuración, ayuda/atajos y cerrar sesión.
- Header: breadcrumb, selector de corrida/investigación cuando aplica, búsqueda global, campana con no leídas y avatar. Búsqueda por RFC, UUID, nombre o ID; `Cmd/Ctrl+K` abre palette.
- En anchos menores de 1024, sidebar como drawer; entre 768–1023 se compactan paneles; en móvil, Documento/Chat/Evidencia son tabs, no tres columnas comprimidas.
- Preferencias de vista sobreviven navegación. Filtros importantes en URL para volver desde evidencia sin perder contexto.

## 4. Login simbólico `/login`

Tarjeta centrada de 380 px: logo documento, “Bienvenido a Forense”, identificador `auditor` y contraseña **`1234`**, mostrar/ocultar contraseña, botón “Entrar”, estado de carga y error inline. Etiqueta “Acceso demo”. Enter envía; foco visible y mensajes asociados al campo.

Implementar gate de demo en servidor con `DEMO_PASSWORD=1234` y cookie de sesión HttpOnly/SameSite. Credencial fija para workspace sintético compartido, no un sistema de autenticación empresarial. No pedir OAuth, recuperación de contraseña ni alta de usuarios para este alcance. Al salir se invalida la sesión y se conserva el historial del workspace.

El perfil editable, teléfonos y llamadas van por endpoints servidor autorizados para esa sesión; no por tablas de lectura pública. Nunca guardar la contraseña ni claves de proveedores en localStorage. El acceso simbólico no habilita llamar a números arbitrarios desde un webhook público.

## 5. Perfil `/perfil` y configuración

Tabs: **General · Preferencias · Avisos y llamadas**.

- General: avatar de iniciales, nombre para saludo, organización y correo de contacto. Inputs etiquetados; cambios pendientes y “Guardar cambios”.
- Preferencias: idioma español, zona horaria `America/Monterrey`, formato MXN, densidad cómoda/compacta, vista inicial y reducción de movimiento. Zona horaria es de presentación, no altera fecha de corte del dataset.
- Avisos: campana/toasts activados, teléfono con selector de país y normalización E.164, toggle “Llámame cuando termine mi investigación”, y checkbox que confirma que es su número y desea estos avisos. Llamadas apagadas hasta guardar número y preferencia.
- Resumen: número enmascarado, estado del canal “Sin configurar/Listo/Error”, última llamada y enlace a su historial. “Probar llamada” es una acción explícita, con estado de envío y límite de frecuencia; no se lanza al guardar ni al abrir la pantalla.
- Distinguir número destinatario del perfil y número emisor de ElevenLabs/Twilio. IDs de agente y secretos se configuran en servidor, no en formulario público.

## 6. Inicio y prompt box de investigación

Mantener la cola actual en `/`; añadir encima un compositor de 2–5 líneas, placeholder “¿Qué quieres investigar?”, chips del dataset/periodo/entidad y botón negro “Investigar”. Adjuntos son selecciones de datasets o evidencia ya cargados; no añadir un importador documental nuevo implícitamente.

**Sugerencias justo encima del prompt**, desplazables en móvil:

- “Seguir el dinero”: rastrear entradas, salidas y retornos del RFC/cluster seleccionado.
- “Buscar facturas sin pago”: conciliar comprobantes del periodo y declarar cobertura faltante.
- “Intentar refutar”: probar explicaciones legítimas de las pistas seleccionadas.
- “Comparar con sus pares”: usar giro/tamaño y métricas disponibles.
- “Explicar esta cadena”: priorizar ruta y evidencias de las aristas seleccionadas.
- “Preparar resumen ejecutivo”: en editor modifica redacción; en investigación solicita un resumen del resultado.

Click selecciona directriz y añade un chip removible; no envía automáticamente. Mostrar “Contexto que se enviará”: corrida, RFC/cluster, periodo, IDs y selección. El usuario puede editar el texto o quitar contexto antes de enviar. Una sugerencia sin contexto necesario aparece deshabilitada con explicación.

Contrato del frontend a `/api/investigaciones`:

```json
{
  "mensaje": "Revisa los retornos de este cluster",
  "directriz_id": "seguir_dinero",
  "directriz_version": 1,
  "contexto": {
    "corrida_id": "<uuid>",
    "cluster_id": "<uuid>",
    "rfcs": ["<rfc>"],
    "evidencia_ids": [],
    "periodo": {"desde": "<ISO UTC>", "hasta_exclusivo": "<ISO UTC>", "timezone": "America/Monterrey"}
  },
  "investigacion_padre_id": null,
  "idempotency_key": "<uuid>"
}
```

El servidor resuelve propietario, directriz permitida y versión; verifica IDs y pertenencia, y construye el contexto desde DB. La directriz va como instrucción de tarea, no puede cambiar políticas, presupuesto ni dictamen determinista. Se persisten mensaje, selección efectiva, versión y hash del contexto. Una directriz nueva sobre una investigación terminada crea otra vinculada; nunca modifica silenciosamente la ejecución anterior. Si cambia el periodo analítico, registrar nueva configuración/snapshot de ejecución, sin confundirlo con filtrar una gráfica.

## 7. Historial `/historial` y detalle de investigación

Vista principal de historial con tabs **Todas · En curso · Completas · Parciales · Errores**, tabla/tarjetas alternables y buscador. Columnas: título, inicio/fin, origen/dataset, autor demo, directriz, estado, progreso real, duración, resultado, reporte y aviso telefónico. Expandir fila muestra ejecuciones técnicas hijas, intentos, agentes y llamadas.

Ruta `/investigaciones/[id]`: resumen de solicitud, versiones y filtros; tabs Resumen, Ejecuciones, Evidencia, Reportes, Actividad. Enlaces a las vistas existentes de corrida/cluster/caso. Acciones “Abrir reporte”, “Descargar”, “Analizar de nuevo” (crea hija), “Copiar enlace” y “Ver actividad”. El historial de `/corridas` se conserva como vista técnica.

No confundir estado de entrega con riesgo: “Investigación completa” puede contener `no_concluyente` si la investigación terminó correctamente con insuficiencia probatoria declarada. Un timeout sin revisión terminada se marca parcial. Estado de llamada vive en otra columna.

## 8. Todas las gráficas comparten controles

Componente único `ChartPanel`: título, unidad, alcance/periodo, selector de vista, filtros, comparación, leyenda, menú de descarga, “Ver datos” y última actualización. `FilterBar`, `DateRangePicker`, `ViewSwitcher` y `DataTable` se reutilizan en historial, métricas, perfiles y detalle.

- Series temporales: línea/área/barras/tabla; granularidad día/semana/mes según volumen.
- Pistas, tipologías, agentes y costes: barras horizontales/verticales/tabla. Ranking ordenable por conteo, monto, duración o coste.
- Embudo: embudo/barras/tabla, denominador por etapa.
- Distribuciones por nivel/familia: barras apiladas/donut/tabla; máximo de categorías legibles y resto en “Otros”.
- Confusión: matriz/tabla, conteos o porcentajes con denominador explícito.
- Grafo: red/lista de aristas/tabla de entidades; capas facturas/dinero/ambas, profundidad, monto mínimo y fechas. Control “Ajustar”, pausar layout y restablecer; ninguna animación inventa actividad.
- Carriles: timeline/lista de eventos, zoom temporal, selector de agente/ronda/intento.

Habilitar solo visualizaciones compatibles con la métrica: no convertir categorías sin orden temporal en una línea engañosa. Leyenda permite activar/desactivar series; click de dato abre o filtra los registros que lo sustentan. Estado seleccionado siempre visible y reversible.

## 9. Fechas flexibles y filtros persistidos

Presets Hoy, Ayer, 7/30/90 días, Mes actual/anterior y Todo el dataset. Rango personalizado de dos calendarios con inputs manuales; zona horaria visible y opción de horas cuando sea pertinente. Comparar periodo anterior equivalente o rango elegido. Limpiar/restablecer accesible.

**Dos alcances separados:** fechas de ejecución para historial y fechas de operaciones para analítica. El segundo se ancla a `fecha_corte` y límites disponibles del snapshot; mostrar “Periodo del dataset” para evitar que Hoy deje vacío un dataset histórico. Convertir extremos a UTC, fin exclusivo; tolerar día de 23/25 horas usando zona horaria. No restar días como múltiplos ciegos de 24 horas.

Filtros combinables: corrida/dataset, investigación, estado, nivel, RFC, giro, familia, agente, tipología, monto, ronda/intento, validez de evidencia, cobertura y estado de llamada. Chips activos con quitar individual, “Limpiar todo”, contador de resultados y “Guardar vista”. URL guarda filtros/vista/granularidad, perfil guarda defaults, `vistas_guardadas` guarda presets nominados. No poner teléfonos completos en URL.

Las gráficas de una misma vista comparten filtros efectivos; comparar corridas exige cohortes comparables y muestra diferencias de snapshot. Filtrar la presentación nunca reejecuta agentes. Una exportación contiene exactamente el conjunto filtrado y su manifiesto.

## 10. Editor tipo Google Docs + chat

Ruta conservada `/casos/[id]/expediente`. Header: icono documento, título editable, breadcrumb, versión y “Guardando/Guardado/Error”; derecha historial, abrir evidencia y botón “Descargar”. Debajo: Archivo/Editar/Ver/Insertar/Formato y barra de herramientas compacta.

- Lienzo gris suave con hoja blanca A4, ancho 794 px aproximado a 100%, margen interior 64; zoom 75/100/125/150 y “Ajustar ancho”. Móvil continuo sin recortar texto. Impresión usa CSS A4, saltos reales y verificación de citas/tablas.
- Izquierda: índice plegable de las ocho secciones y navegación a encabezados. Centro: TipTap. Derecha: chat de 360 px redimensionable; tabs Chat/Evidencia. Toolbar incluye encabezados, negrita, cursiva, listas, alineación, enlaces, tablas y deshacer/rehacer.
- Modos “Editar”, “Sugerir”, “Lectura”. Modo sugerir presenta diffs con aceptar/rechazar; no implica implementar colaboración multiusuario en tiempo real. Historial mantiene versiones por autor y cambios de IA.
- Guardado automático tras 1 s sin escritura; botón guardar y `Cmd/Ctrl+S` lo fuerzan. `version_base` y revisión optimista previenen sobreescritura; conflicto conserva borrador y muestra comparación. Selección dirigida a IA guarda rango/IDs de bloques y texto/hash para detectar desplazamientos.
- Documento canónico: JSON TipTap versionado y Markdown derivado para compatibilidad/exportación; no hacer round-trip continuo por Markdown que pierda tablas, marcas o anclas. Versiones legadas de solo Markdown se importan una vez. Guardar ambos en la misma operación.
- Citas clicables abren registro fuente en drawer sin perder selección. Corrección de estilo conserva citas; un número cambiado manualmente queda pendiente de validación, no se presenta como hecho verificado. Estado “revisar citas” bloquea publicación final, no la conservación del borrador.

**Chat:** sugerencias arriba del input: “Resume esta sección”, “Explica la evidencia”, “Hazlo más claro”, “Agrega las limitaciones”, “Propón próximos pasos”. Incluye chips removibles de selección, versión, evidencia y alcance. Enviar pregunta devuelve mensaje; enviar edición devuelve una propuesta con diff y botones **Aplicar / Descartar**. Aplicar crea versión; si cambió `version_base`, recalcular propuesta con confirmación explícita de la selección actual. Indicador de escritura se basa en request activo, no en reproducción ficticia de pensamiento.

Contrato de edición: `{caso_id,version_base,modo:pregunta|propuesta,seleccion:{from,to,block_ids,texto_hash}?,directriz_id?,mensaje,evidencia_ids,idempotency_key}`. Backend resuelve documentos/contexto y guarda eventos. Propuesta devuelve `{propuesta_id,version_base,mensaje,patch,diff,citas}`; el botón Aplicar llama operación determinista con `propuesta_id`. No se inserta una nueva versión al generar la propuesta. Cambia el guardado automático del diseño anterior, no elimina edición/chat/historial.

## 11. Descargas y notificaciones

Dropdown de reporte: PDF, Markdown y JSON del expediente/evidencia; DOCX queda identificado como ampliación opcional, no requerido para cerrar estas 36 horas. Gráficas: PNG/SVG cuando el renderer lo soporte, y CSV de datos; todas ofrecen CSV/tabla aunque no soporten ambos formatos de imagen. Historial/bitácora: CSV y JSON. Mostrar generando, éxito/enlace o error/reintentar.

Cada descarga lleva nombre legible, ID, versión, fecha, filtros y hash del contenido; datos exportados respetan perfil/scope. Botón copiar enlace conserva filtros y requiere la misma sesión para acceder; no crea publicación pública.

Toasts dentro de la webapp, abajo a la derecha en desktop/arriba en móvil: guardado, investigación iniciada, reporte listo, llamada solicitada, exportación lista, errores. Éxito 4 s; error permanece hasta cerrar; máximo tres visibles con agrupación. Campana y `/notificaciones` conservan historial leído/no leído con acción al recurso. Un toast no sustituye el registro persistido; cambios de foco o refresco no repiten el mismo evento.

Toast de fin: **“Investigación completa. Tu reporte está listo.”** Acciones Abrir/Descargar. Aviso telefónico usa el flujo de `16-notificaciones-elevenlabs.md` y su estado propio; fallo de llamada no cambia el resultado forense.

## 12. Movimiento, estados y webapp

Hover/foco 120 ms; popover 160; drawer 220; transición de tabs 140; entrada de toast 180; expansión de detalle 180. Curva suave de salida. Grafo puede estabilizar layout al cargar, después fija nodos; contadores no cuentan desde cero en cada render. Transiciones animan opacity/transform, no tablas enteras. Respetar `prefers-reduced-motion` y preferencia de perfil.

Estados completos: skeleton de carga, vacío con siguiente acción, sin coincidencias con limpiar filtros, error con reintentar, datos parciales con cobertura, desconexión con última actualización. Atajos documentados en ayuda. Navegación completa por teclado, Escape cierra overlays, foco retorna al disparador.

Webapp responsive con metadata, favicon, manifest `display=standalone` y theme color blanco. Si se habilita instalación, probar iconos y rutas profundas; no añadir sincronización offline ni cachear reportes privados automáticamente.

## 13. Componentes y prueba de aceptación

**Entrada de datasets (`/datos`, contrato19):** uploader → perfil detectado → mapping por columnas con antes/después sanitizado → advertencias/cobertura → confirmación → progreso real de lotes → snapshot listo. Reutilizar tokens, tablas y toasts de este documento. Propuesta IA y mapeo manual usan el mismo validador; no mostrar “compatible” solo porque el modelo produjo JSON. La importación no dispara la llamada de investigación completa.

Entregables del carril UI: tokens, `AppShell`, `DemoLogin`, `ProfileSettings`, `InvestigationComposer`, `SuggestionChips`, `FilterBar`, `DateRangePicker`, `ChartPanel`, `ExecutionHistory`, `TraceDrawer`, `DocumentWorkspace`, `ReportChat`, `VersionDiff`, `DownloadMenu`, `NotificationCenter` y `ToastProvider`. Preferir wrappers de shadcn ya elegido, Recharts y TipTap; no dos bibliotecas por función.

Probar a 1440/1024/390 px: login 1234, guardar perfil, nueva investigación con sugerencia, filtros restaurados al volver, alternar todas las gráficas a tabla, selección→propuesta→aplicar, conflicto de versión, PDF sin recortes, notificación y llamada con estado verificable. Presupuestos incrementales y gates en §12; este archivo es la referencia visual común para todos los componentes.
