import type { AuditorPaso } from "@/lib/data/source";

/**
 * Rastro del dinero como diagrama de secuencia (guía de jueces: "a rendered
 * diagram, not prose"). Misma geometría que `src/auditor/casefile.py`, para
 * que la web y el expediente entregado se lean igual.
 */
export function RastroDinero({ pasos, etiquetas }: { pasos: AuditorPaso[]; etiquetas: Record<string, string> }) {
  const nodos: string[] = [];
  for (const p of pasos) for (const n of [p.from, p.to]) if (!nodos.includes(n)) nodos.push(n);
  const colw = 230;
  const left = 20;
  const top = 70;
  const rowh = 46;
  const width = left * 2 + colw * Math.max(nodos.length, 2);
  const height = top + rowh * pasos.length + 30;
  const x = (n: string) => left + colw * nodos.indexOf(n) + colw / 2;
  const mxn = (v: number) => `MXN ${v.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Rastro del dinero" className="text-text">
        <defs>
          <marker id="flecha-rastro" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
            <path d="M0,0 L10,4 L0,8 z" fill="currentColor" />
          </marker>
        </defs>
        {nodos.map((n) => (
          <g key={n}>
            <line x1={x(n)} y1={top - 14} x2={x(n)} y2={height - 10} stroke="#d6d3cd" strokeDasharray="4 4" />
            <rect x={x(n) - 105} y={8} width={210} height={44} rx={8} fill="#fff" stroke="#1b1f24" />
            <text x={x(n)} y={27} textAnchor="middle" fontSize={12} fontWeight={600} fill="currentColor">
              {n === "COMPANY" ? "EMPRESA" : n}
            </text>
            <text x={x(n)} y={43} textAnchor="middle" fontSize={11} fill="#6b6964">
              {(etiquetas[n] ?? "").slice(0, 30)}
            </text>
          </g>
        ))}
        {pasos.map((p, i) => {
          const y = top + rowh * i + 20;
          const x1 = x(p.from);
          let x2 = x(p.to);
          if (x1 === x2) x2 = x1 + 60;
          const pad = x2 > x1 ? 6 : -6;
          return (
            <g key={`${p.exhibit_id}-${i}`}>
              <line x1={x1} y1={y} x2={x2 - pad} y2={y} stroke="currentColor" strokeWidth={2} markerEnd="url(#flecha-rastro)" />
              <text x={(x1 + x2) / 2} y={y - 7} textAnchor="middle" fontSize={12} fill="currentColor">
                {mxn(p.amount)} · {p.date} · {p.exhibit_id}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
