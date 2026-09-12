"use client";

/**
 * Estilos de la hoja A4 y del CSS de impresión (15 §10-11).
 *
 * Van en un `<style>` del propio componente en vez de en `globals.css` porque
 * `app/globals.css` es de forense-webapp: el editor no toca archivos ajenos.
 * Tailwind v4 no genera `@page`, y el PDF se produce imprimiendo esta hoja, sin
 * una segunda biblioteca de render.
 */
export function EstilosHoja() {
  return (
    <style>{`
.hoja-a4 {
  width: 794px;                 /* A4 a ~96dpi, 15 §10 */
  min-height: 1123px;
  padding: 64px;                /* margen interior */
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  box-shadow: 0 1px 2px rgba(0,0,0,.04);
}
.hoja-prosa { outline: none; color: var(--text); font-size: 14px; line-height: 22px; }
.hoja-prosa:focus { outline: none; }
.hoja-prosa h1 { font-size: 24px; line-height: 32px; font-weight: 600; margin: 20px 0 10px; }
.hoja-prosa h2 { font-size: 18px; line-height: 26px; font-weight: 600; margin: 18px 0 8px; }
.hoja-prosa h3 { font-size: 15px; line-height: 22px; font-weight: 600; margin: 14px 0 6px; }
.hoja-prosa h4 { font-size: 14px; font-weight: 600; margin: 12px 0 6px; }
.hoja-prosa p { margin: 0 0 10px; }
.hoja-prosa ul, .hoja-prosa ol { margin: 0 0 10px; padding-left: 22px; }
.hoja-prosa li { margin: 2px 0; }
.hoja-prosa li > p { margin: 0; }
.hoja-prosa blockquote {
  margin: 0 0 10px; padding: 4px 0 4px 12px;
  border-left: 3px solid var(--border); color: var(--text-muted);
}
.hoja-prosa hr { border: none; border-top: 1px solid var(--border); margin: 16px 0; }
.hoja-prosa a { color: var(--info); text-decoration: underline; }
.hoja-prosa table { border-collapse: collapse; width: 100%; margin: 0 0 12px; table-layout: fixed; }
.hoja-prosa th, .hoja-prosa td { border: 1px solid var(--border); padding: 6px 8px; vertical-align: top; }
.hoja-prosa th { background: var(--surface-muted); font-weight: 600; text-align: left; }
.hoja-prosa .selectedCell { background: rgba(37,99,235,.08); }

/* Citas: decoraciones de ProseMirror, no nodos del documento. */
.hoja-prosa .cita {
  border-radius: 999px; padding: 1px 5px; margin: 0 1px;
  background: var(--surface-muted); border: 1px solid var(--border);
  color: var(--text-muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px; cursor: pointer;
}
.hoja-prosa .cita-invalida {
  background: rgba(185,28,28,.08); border-color: rgba(185,28,28,.4); color: var(--error);
}
.hoja-prosa .ProseMirror-selectednode { outline: 2px solid var(--focus); }

@media print {
  @page { size: A4; margin: 18mm; }
  html, body { background: #fff !important; }
  .print\\:hidden, nav, aside, header button, [data-no-print] { display: none !important; }
  .lienzo-editor { padding: 0 !important; background: #fff !important; overflow: visible !important; }
  .zoom-hoja { transform: none !important; width: auto !important; }
  .hoja-a4 {
    width: auto !important; min-height: 0 !important; padding: 0 !important;
    border: none !important; box-shadow: none !important; border-radius: 0 !important;
  }
  .hoja-prosa h1, .hoja-prosa h2, .hoja-prosa h3 { break-after: avoid-page; }
  .hoja-prosa p, .hoja-prosa li, .hoja-prosa blockquote { break-inside: avoid-page; }
  .hoja-prosa table, .hoja-prosa tr, .hoja-prosa .cita { break-inside: avoid; }
  .hoja-prosa a[href]::after { content: " (" attr(href) ")"; font-size: 10px; color: #555; }
}
`}</style>
  );
}
