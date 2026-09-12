"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { EmbudoEtapa } from "@/lib/data";

const COLORES = ["var(--fam-d)", "var(--fam-f)", "var(--fam-r)", "var(--fam-t)", "var(--fam-e)"];

/**
 * 09 §7: embudo pistas -> RFC candidatos -> clusters -> casos ≥2 familias ->
 * presunción alta, mostrando dónde se filtra el ruido. Barras horizontales
 * con el denominador explícito en el tooltip (nunca solo el conteo).
 */
export function EmbudoChart({ etapas }: { etapas: EmbudoEtapa[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={etapas} layout="vertical" margin={{ left: 24 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11 }} />
        <YAxis type="category" dataKey="etapa" tick={{ fontSize: 11 }} width={140} />
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
