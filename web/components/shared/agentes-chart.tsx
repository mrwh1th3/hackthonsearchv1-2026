"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface TokensPorAgente {
  agente: string;
  tokens_in: number;
  tokens_out: number;
}

/** Barra apilada tokens in/out por agente (rol de `ejecuciones_agente`), datos reales del runtime — nunca inventados. */
export function AgentesChart({ datos }: { datos: TokensPorAgente[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={datos} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey="agente" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip formatter={(value) => (typeof value === "number" ? value.toLocaleString("es-MX") : String(value ?? ""))} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="tokens_in" stackId="tokens" name="Entrada" fill="var(--primary)" />
        <Bar dataKey="tokens_out" stackId="tokens" name="Salida" fill="var(--border-strong)" />
      </BarChart>
    </ResponsiveContainer>
  );
}
