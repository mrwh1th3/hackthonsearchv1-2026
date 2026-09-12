import * as Tabs from "@radix-ui/react-tabs";
import Link from "next/link";
import { notFound } from "next/navigation";
import { NivelBadge } from "@/components/shared/badges";
import { FixtureBadge } from "@/components/shared/fixture-badge";
import { ClusterForceGraph } from "@/components/shared/force-graph";
import { TrayectoriaPanel } from "@/components/shared/trayectoria-panel";
import { getDataSource } from "@/lib/data";
import { CasoPanels } from "./caso-panels";
import { CasoTimeline } from "./caso-timeline";

export const metadata = { title: "Forense · Caso" };
export const dynamic = "force-dynamic";

export default async function CasoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ds = getDataSource();
  const detalle = await ds.getCasoDetalle(id);
  if (!detalle) notFound();
  const { caso } = detalle;

  const [entidad, bitacora, grafo, trayectoria, contraste] = await Promise.all([
    ds.getEntidad(caso.rfc_principal, caso.corrida_id),
    ds.getBitacoraCaso(id),
    ds.getClusterGrafo(caso.cluster_id),
    ds.getTrayectoria(caso.rfc_principal, caso.corrida_id),
    ds.getContraste(id),
  ]);

  const timeline = <CasoTimeline eventos={bitacora} />;
  const grafoEl = <ClusterForceGraph nodos={grafo?.nodos ?? []} aristas={grafo?.aristas ?? []} height={320} />;
  const panels = <CasoPanels detalle={detalle} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-mono text-xl font-semibold text-text">{caso.rfc_principal}</h1>
            <NivelBadge nivel={caso.nivel} />
          </div>
          <p className="text-sm text-text-subtle" title="dato no confiable, no citable en el dictamen">
            {entidad?.razon_social_untrusted ?? "Razón social no disponible"}
          </p>
          <p className="mt-1 text-xs text-text-subtle">
            {caso.tipologia} · estado {caso.estado} · {caso.n_reintentos} reintento(s) · {caso.moneda} {Number(caso.monto_en_riesgo).toLocaleString("es-MX", { minimumFractionDigits: 2 })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/clusters/${caso.cluster_id}`} className="h-8 rounded-[var(--radius-input)] border border-border px-3 text-xs leading-8 hover:bg-surface-hover">
            Ver cluster
          </Link>
          <Link href={`/casos/${id}/expediente`} className="h-8 rounded-[var(--radius-input)] bg-primary px-3 text-xs leading-8 text-white hover:bg-primary-hover">
            Abrir expediente
          </Link>
          <FixtureBadge />
        </div>
      </div>

      {/* Desktop: 3 columnas */}
      <div className="hidden gap-4 lg:grid lg:grid-cols-3">
        <div>{timeline}</div>
        <div>{grafoEl}</div>
        <div>{panels}</div>
      </div>

      {/* Móvil/tablet: tabs (09 §3) */}
      <Tabs.Root defaultValue="timeline" className="lg:hidden">
        <Tabs.List className="mb-3 flex gap-1 border-b border-border" aria-label="Secciones del caso">
          {[
            ["timeline", "Bitácora"],
            ["grafo", "Grafo"],
            ["paneles", "Pistas/Evidencia"],
          ].map(([v, l]) => (
            <Tabs.Trigger key={v} value={v} className="border-b-2 border-transparent px-3 py-2 text-sm text-text-muted data-[state=active]:border-primary data-[state=active]:text-text">
              {l}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="timeline">{timeline}</Tabs.Content>
        <Tabs.Content value="grafo">{grafoEl}</Tabs.Content>
        <Tabs.Content value="paneles">{panels}</Tabs.Content>
      </Tabs.Root>

      {trayectoria.length > 0 && <TrayectoriaPanel rfc={caso.rfc_principal} puntos={trayectoria} />}

      {contraste && (
        <section className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
          <h2 className="mb-2 text-sm font-medium text-text">Contraste — por qué esta sí y aquella no</h2>
          <p className="text-sm text-text">
            Comparable <Link href={`/entidades/${encodeURIComponent(contraste.rfc_comparable)}`} className="font-mono text-focus hover:underline">{contraste.rfc_comparable}</Link>{" "}
            ({contraste.giro_compartido}) compartió las pistas {contraste.pistas_solapadas.join(", ")} y cerró en <NivelBadge nivel={contraste.resultado_comparable} className="align-middle" />.
          </p>
          <p className="mt-1 text-xs text-text-subtle">Razón: {contraste.razon_tipificada.replaceAll("_", " ")}. {contraste.explicacion}</p>
        </section>
      )}
    </div>
  );
}
