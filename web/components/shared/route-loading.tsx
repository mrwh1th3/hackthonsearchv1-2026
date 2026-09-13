/**
 * Estado de carga de las rutas pesadas (`loading.tsx`). Next lo pinta en
 * cuanto se pulsa el enlace, mientras el servidor arma la página: el clic se
 * nota al instante aunque las lecturas tarden. Usa el spinner del panel
 * (16px, `insp-spin .8s`) para no introducir otro lenguaje visual.
 */
export function RouteLoading({ texto }: { texto: string }) {
  return (
    <section
      role="status"
      aria-live="polite"
      className="flex min-h-[70dvh] flex-col items-center justify-center gap-3 px-[22px]"
    >
      <span
        aria-hidden
        className="h-5 w-5 rounded-full border-2 border-[#e3e0da] border-t-text"
        style={{ animation: "insp-spin .8s linear infinite" }}
      />
      <span className="text-[13px] text-text-muted">{texto}</span>
    </section>
  );
}
