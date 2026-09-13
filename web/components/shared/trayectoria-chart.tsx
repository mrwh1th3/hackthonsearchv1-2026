"use client";

import { CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TrayectoriaPunto } from "@/lib/data";

const EVENTO_LABEL: Record<string, string> = {
  alta: "Alta",
  primer_cfdi: "Primer CFDI",
  pico: "Pico",
  silencio: "Silencio",
  publicacion_69b: "69-B publication",
};

/**
 * 21 §2 / §4: serie mensual obligatoria en el expediente y en /entidades,
 * con eventos marcados (alta, primer CFDI, pico, silencio, publicación
 * 69-B). Calculada por SQL/fixture, nunca inventada por el Redactor.
 */
export function TrayectoriaChart({ puntos }: { puntos: TrayectoriaPunto[] }) {
  const data = puntos.map((p) => ({
    ...p,
    monto_emitido: Number(p.monto_emitido),
    monto_recibido: Number(p.monto_recibido),
    etiquetaEvento: p.eventos.length > 0 ? p.eventos.map((e) => EVENTO_LABEL[e] ?? e).join(" + ") : undefined,
  }));

  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey="periodo" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip
          formatter={(value, name) => [typeof value === "number" ? value.toLocaleString("es-MX") : String(value ?? ""), String(name)]}
          labelFormatter={(label, payload) => {
            const evento = payload?.[0]?.payload?.etiquetaEvento;
            return evento ? `${label} · ${evento}` : label;
          }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line type="monotone" dataKey="monto_emitido" name="Monto emitido" stroke="var(--fam-f)" strokeWidth={2} dot={{ r: 3 }} />
        <Line type="monotone" dataKey="monto_recibido" name="Monto recibido" stroke="var(--fam-r)" strokeWidth={2} dot={{ r: 3 }} />
        <Line type="monotone" dataKey="n_cfdi" name="N° CFDI" stroke="var(--text-subtle)" strokeWidth={1} strokeDasharray="4 2" dot={false} yAxisId={0} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
