import Link from "next/link";
import { FixtureBadge } from "@/components/shared/fixture-badge";
import { getDataSource } from "@/lib/data";

export const metadata = { title: "Forense · Navegación de prueba" };
export const dynamic = "force-dynamic";

/**
 * Navegación de prueba: un índice de TODAS las pantallas con enlaces que
 * funcionan, para revisar la UI completa de un tirón (pedido del usuario,
 * 2026-09-12: "navegación de prueba también para aprobar todo, ver todo UI").
 *
 * Los ids NO están escritos a mano: salen del `DataSource` en tiempo de
 * petición, así que la página sirve igual con fixtures que contra Supabase y
 * nunca ofrece un enlace a un id que no existe. Si algo falta, lo dice en vez
 * de dar un enlace roto — un 404 en una pantalla de revisión se lee como "esa
 * vista está mal" cuando el problema era el enlace.
 */
export default async function RutasPage() {
  const ds = getDataSource();
  const corridas = await ds.listCorridas();
  const corrida = corridas[0] ?? null;
  const casos = corrida ? await ds.listCasos({ corridaId: corrida.id }) : [];
  const clusters = corrida ? await ds.listClusters(corrida.id) : [];
  const investigaciones = await ds.listInvestigaciones();
  const inyecciones = await ds.listInyecciones();

  const grupos: { titulo: string; nota?: string; filas: { ruta: string; href: string | null; que: string }[] }[] = [
    {
      titulo: "El diseño Inspector",
      nota: "Las pantallas del diseño que se implementó, con sus animaciones.",
      filas: [
        { ruta: "/", href: "/", que: "Hero, picker de corridas y composer" },
        {
          ruta: "/?corrida=…",
          href: corrida ? `/?corrida=${corrida.id}` : null,
          que: "Corrida elegida: composer abierto, rango de fechas y alcance de pistas",
        },
        {
          ruta: "/corridas/[id]",
          href: corrida ? `/corridas/${corrida.id}` : null,
          que: "Board: Canvas del cluster y Timeline de la bitácora",
        },
      ],
    },
    {
      titulo: "Casos y dictamen",
      filas: [
        { ruta: "/casos", href: "/casos", que: "Cola de casos con sus KPI y filtros" },
        ...casos.slice(0, 4).map((c) => ({
          ruta: `/casos/[id]`,
          href: `/casos/${c.id}`,
          que: `Detalle — nivel ${c.nivel}`,
        })),
        ...(casos[0]
          ? [{ ruta: "/casos/[id]/expediente", href: `/casos/${casos[0].id}/expediente`, que: "Expediente con editor y versiones" }]
          : []),
      ],
    },
    {
      titulo: "Corridas, clusters y entidades",
      filas: [
        { ruta: "/corridas", href: "/corridas", que: "Listado de corridas" },
        {
          ruta: "/corridas/[id]/raw",
          href: corrida ? `/corridas/${corrida.id}/raw` : null,
          que: "Datos crudos de la corrida",
        },
        ...clusters.slice(0, 2).map((cl) => ({
          ruta: "/clusters/[id]",
          href: `/clusters/${cl.id}`,
          que: "Cluster: grafo y señales",
        })),
        ...(casos[0]
          ? [{
              ruta: "/entidades/[rfc]",
              href: `/entidades/${encodeURIComponent(casos[0].rfc_principal)}`,
              que: "Perfil de entidad y Trayectoria",
            }]
          : []),
        { ruta: "/datos", href: "/datos", que: "Explorador de datos e ingesta" },
        { ruta: "/estadisticas", href: "/estadisticas", que: "Comparativa entre corridas" },
      ],
    },
    {
      titulo: "Producto",
      filas: [
        { ruta: "/historial", href: "/historial", que: "Investigaciones anteriores" },
        ...investigaciones.slice(0, 2).map((i) => ({
          ruta: "/investigaciones/[id]",
          href: `/investigaciones/${i.id}`,
          que: "Investigación: trazas y reporte",
        })),
        ...inyecciones.slice(0, 1).map((iy) => ({
          ruta: "/inyecciones/[id]",
          href: `/inyecciones/${iy.id}`,
          que: "Inyección en vivo: timeline y diff antes/después",
        })),
        { ruta: "/notificaciones", href: "/notificaciones", que: "Centro de notificaciones" },
        { ruta: "/perfil", href: "/perfil", que: "Perfil, teléfono y preferencias" },
        { ruta: "/metodo", href: "/metodo", que: "Método, decisiones y estado" },
        { ruta: "/login", href: "/login", que: "Entrada (cierra la sesión actual al usarla)" },
      ],
    },
  ];

  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-7 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-[26px] font-medium tracking-[-0.025em] text-text">Navegación de prueba</h1>
          <p className="text-[13px] text-text-subtle">
            Todas las pantallas con enlaces que funcionan. Los ids salen de los datos, no están escritos a mano.
          </p>
        </div>
        <FixtureBadge />
      </div>

      {grupos.map((g) => (
        <section key={g.titulo} className="flex flex-col gap-2.5">
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-text-subtle">{g.titulo}</span>
            {g.nota && <span className="text-[12px] text-text-subtle">{g.nota}</span>}
          </div>
          <div className="flex flex-col gap-1.5">
            {g.filas.map((f, i) =>
              f.href ? (
                <Link
                  key={`${f.ruta}-${i}`}
                  href={f.href}
                  className="flex items-center gap-3 rounded-[11px] border border-border bg-surface px-3.5 py-2.5 transition-colors hover:border-[var(--border-strong)] hover:bg-surface-hover"
                >
                  <span className="flex-none font-mono text-[12px] text-text">{f.ruta}</span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-text-subtle">{f.que}</span>
                  <span className="flex-none text-[11.5px] text-text-subtle">Abrir</span>
                </Link>
              ) : (
                <div
                  key={`${f.ruta}-${i}`}
                  className="flex items-center gap-3 rounded-[11px] border border-dashed border-border bg-surface-muted px-3.5 py-2.5"
                >
                  <span className="flex-none font-mono text-[12px] text-text-subtle">{f.ruta}</span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-text-subtle">{f.que}</span>
                  <span className="flex-none text-[11.5px] text-text-subtle">sin datos todavía</span>
                </div>
              ),
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
