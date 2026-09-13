"use client";

import * as Tabs from "@radix-ui/react-tabs";
import * as Switch from "@radix-ui/react-switch";
import { useState } from "react";
import { toast } from "sonner";
import type { Perfil } from "@/lib/data";
import { cn } from "@/lib/utils";
import { AppSelect } from "./app-select";

/**
 * 15 §5: General/Preferencias/Avisos y llamadas. "Test call" es una
 * acción explícita, deshabilitada con motivo cuando no hay número saliente
 * configurado (21 §5: ElevenLabs sin números salientes en este entorno).
 * "Save changes" no finge persistencia: no existe todavía un endpoint de
 * perfil en el BFF (fuera del alcance de api/session, api/investigaciones,
 * api/inyecciones de este corte) — se declara honestamente por toast y en
 * solicitudes_coordinador.
 */
export function ProfileSettings({ perfil }: { perfil: Perfil }) {
  const [nombre, setNombre] = useState(perfil.nombre);
  const [organizacion, setOrganizacion] = useState(perfil.organizacion);
  const [correo, setCorreo] = useState(perfil.correo ?? "");
  const [telefono, setTelefono] = useState(perfil.telefono_e164 ?? "");
  const [llamadasActivadas, setLlamadasActivadas] = useState(perfil.llamadas_activadas);
  const [confirmaNumero, setConfirmaNumero] = useState(Boolean(perfil.consentimiento_at));
  const [zonaHoraria, setZonaHoraria] = useState(perfil.timezone || "America/Monterrey");
  const [densidad, setDensidad] = useState<"comoda" | "compacta">("comoda");
  const [reduccionMovimiento, setReduccionMovimiento] = useState(false);

  const numeroConfigurado = telefono.trim().length > 0 && confirmaNumero;

  function guardar(seccion: string) {
    toast(`"${seccion}" cannot be saved yet: the profile endpoint is not configured.`, { duration: 6000 });
  }

  function probarLlamada() {
    // Deshabilitado por diseño mientras no exista un número saliente; ver disabled del botón.
  }

  const enmascarado = telefono ? telefono.replace(/\d(?=\d{2})/g, "•") : null;

  return (
    <Tabs.Root defaultValue="general">
      <Tabs.List className="mb-4 flex gap-1 border-b border-border" aria-label="Profile sections">
        {["general", "preferencias", "avisos"].map((v) => (
          <Tabs.Trigger key={v} value={v} className="border-b-2 border-transparent px-3 py-2 text-sm capitalize text-text-muted data-[state=active]:border-primary data-[state=active]:text-text">
            {{ general: "General", preferencias: "Preferences", avisos: "Notifications & calls" }[v]}
          </Tabs.Trigger>
        ))}
      </Tabs.List>

      <Tabs.Content value="general" className="max-w-md space-y-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-sm font-medium text-white">
          {nombre.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
        </div>
        <Field label="Display name" value={nombre} onChange={setNombre} />
        <Field label="Organization" value={organizacion} onChange={setOrganizacion} />
        <Field label="Contact email" value={correo} onChange={setCorreo} type="email" />
        <button type="button" onClick={() => guardar("General")} className="h-9 rounded-[var(--radius-input)] bg-primary px-3 text-sm text-white hover:bg-primary-hover">
          Save changes
        </button>
      </Tabs.Content>

      <Tabs.Content value="preferencias" className="max-w-md space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-text-muted" htmlFor="tz">Time zone</label>
          <AppSelect id="tz" aria-label="Time zone" value={zonaHoraria} onValueChange={setZonaHoraria} className="w-full" options={["America/Monterrey", "America/Mexico_City", "America/Chicago"].map(value => ({ value, label: value }))} />
          <p className="mt-1 text-[11px] text-text-subtle">Display setting only; the dataset cutoff is unchanged.</p>
        </div>
        <div>
          <span className="mb-1 block text-xs font-medium text-text-muted">Density</span>
          <div className="flex gap-2">
            {(["comoda", "compacta"] as const).map((d) => (
              <button
                key={d === "comoda" ? "Comfortable" : "Compact"}
                type="button"
                onClick={() => setDensidad(d)}
                aria-pressed={densidad === d}
                className={cn("h-8 rounded-full border px-3 text-xs capitalize", densidad === d ? "border-primary bg-primary text-white" : "border-border text-text hover:bg-surface-hover")}
              >
                {d === "comoda" ? "Comfortable" : "Compact"}
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-text">
          <Switch.Root
            checked={reduccionMovimiento}
            onCheckedChange={setReduccionMovimiento}
            className="relative h-5 w-9 rounded-full bg-surface-muted data-[state=checked]:bg-primary"
          >
            <Switch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white transition-transform data-[state=checked]:translate-x-4" />
          </Switch.Root>
          Reduce motion
        </label>
        <button type="button" onClick={() => guardar("Preferences")} className="h-9 rounded-[var(--radius-input)] bg-primary px-3 text-sm text-white hover:bg-primary-hover">
          Save changes
        </button>
      </Tabs.Content>

      <Tabs.Content value="avisos" className="max-w-md space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-text-muted" htmlFor="tel">Phone</label>
          <input
            id="tel"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            placeholder="+52..."
            className="h-9 w-full rounded-[var(--radius-input)] border border-border bg-surface px-3 text-sm"
          />
        </div>
        <label className="flex items-start gap-2 text-xs text-text-muted">
          <input type="checkbox" checked={confirmaNumero} onChange={(e) => setConfirmaNumero(e.target.checked)} className="mt-0.5" />
          I confirm this is my number and want to receive these notifications.
        </label>
        <label className="flex items-center gap-2 text-sm text-text">
          <Switch.Root
            checked={llamadasActivadas}
            onCheckedChange={setLlamadasActivadas}
            disabled={!numeroConfigurado}
            className="relative h-5 w-9 rounded-full bg-surface-muted data-[state=checked]:bg-primary disabled:opacity-40"
          >
            <Switch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white transition-transform data-[state=checked]:translate-x-4" />
          </Switch.Root>
          Call me when the investigation finishes
        </label>
        {!numeroConfigurado && <p className="text-[11px] text-text-subtle">Calls remain off until you save your number and consent.</p>}

        <div className="rounded-[var(--radius-input)] border border-border bg-surface-muted p-3 text-xs text-text-muted">
          <p>Number: {enmascarado ?? "Not configured"}</p>
          <p>Channel status: {numeroConfigurado ? "Ready" : "Not configured"}</p>
          <p>Last call: —</p>
        </div>

        <button
          type="button"
          onClick={probarLlamada}
          disabled
          title="no outbound number configured"
          className="h-9 rounded-[var(--radius-input)] border border-border px-3 text-sm text-text-subtle opacity-60"
        >
          Test call
        </button>
        <p className="text-[11px] text-text-subtle">Unavailable: no outbound phone number configured.</p>

        <button type="button" onClick={() => guardar("Notifications & calls")} className="block h-9 rounded-[var(--radius-input)] bg-primary px-3 text-sm text-white hover:bg-primary-hover">
          Save changes
        </button>
      </Tabs.Content>
    </Tabs.Root>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-text-muted">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-full rounded-[var(--radius-input)] border border-border bg-surface px-3 text-sm" />
    </div>
  );
}
