/**
 * Estado de carga de las rutas pesadas (`loading.tsx`). Next lo pinta en
 * cuanto se pulsa el enlace, mientras el servidor arma la página: el clic se
 * nota al instante aunque las lecturas tarden. Usa el spinner del panel
 * (`insp-spin .8s`) para no introducir otro lenguaje visual. Sin texto visible
 * a pedido del usuario (2026-09-12); `aria-label` lo anuncia a lectores de pantalla.
 */
export function RouteLoading({ texto }: { texto: string }) {
  return (
    <section role="status" aria-label={texto} className="flex min-h-[70dvh] items-center justify-center px-[22px]">
      <span
        aria-hidden
        className="h-5 w-5 rounded-full border-2 border-[#e3e0da] border-t-text"
        style={{ animation: "insp-spin .8s linear infinite" }}
      />
    </section>
  );
}
