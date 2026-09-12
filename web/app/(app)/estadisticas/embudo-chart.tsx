"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { EmbudoEtapa } from "@/lib/data";

const COLORES = ["var(--fam-d)", "var(--fam-f)", "var(--fam-r)", "var(--fam-t)", "var(--fam-e)"];

/**
 * 09 §7: barras horizontales con el denominador explícito en el tooltip
 * (nunca solo el conteo). Genérico: lo alimenta tanto la cobertura de
 * `v_metricas_corrida` (universo -> concluyentes -> trampas investigadas)
 * como cualquier otro embudo etapa/cantidad/denominador futuro.
 */
export function EmbudoChart({ etapas }: { etapas: EmbudoEtapa[] }) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={etapas} layout="vertical" margin={{ left: 24 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11 }} />
        <YAxis type="category" dataKey="etapa" tick={{ fontSize: 11 }} width={160} />
        <Tooltip formatter={(value, _name, item) => [`${value} / ${item.payload.denominador}`, "cantidad / denominador"]} />
        <Bar dataKey="cantidad" radius={[0, 4, 4, 0]}>
          {etapas.map((e, i) => (
            <Cell key={e.etapa} fill={COLORES[i % COLORES.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
