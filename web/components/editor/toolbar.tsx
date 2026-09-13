"use client";

import * as Popover from "@radix-ui/react-popover";
import type { Editor } from "@tiptap/react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Table as TableIcon,
  Underline as UnderlineIcon,
  Undo2,
} from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import { AppSelect } from "@/components/shared/app-select";

/**
 * Barra de herramientas compacta (15 §10): encabezados, negrita, cursiva,
 * subrayado, tachado, listas, alineación, enlaces, tablas y deshacer/rehacer.
 *
 * Todo lo que ofrece produce nodos y marcas que el contrato acepta: no hay
 * botón de bloque de código ni de salto forzado, porque `editor.block` no los
 * admite y el documento dejaría de validar.
 */

interface BotonProps {
  onClick: () => void;
  activo?: boolean;
  deshabilitado?: boolean;
  etiqueta: string;
  children: React.ReactNode;
}

function Boton({ onClick, activo, deshabilitado, etiqueta, children }: BotonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={deshabilitado}
      aria-label={etiqueta}
      aria-pressed={activo}
      title={etiqueta}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-input)] text-text-muted transition-colors",
        "hover:bg-surface-hover hover:text-text disabled:cursor-not-allowed disabled:opacity-40",
        activo && "bg-surface-muted text-text",
      )}
    >
      {children}
    </button>
  );
}

function Separador() {
  return <span aria-hidden className="mx-1 h-5 w-px bg-border" />;
}

export function EditorToolbar({ editor, deshabilitado }: { editor: Editor | null; deshabilitado: boolean }) {
  const [href, setHref] = useState("");
  if (!editor) return null;

  const nivelActual = [1, 2, 3, 4].find((n) => editor.isActive("heading", { level: n }));

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-surface px-2 py-1 print:hidden" role="toolbar" aria-label="Formatting">
      <AppSelect
        aria-label="Paragraph style"
        size="sm"
        disabled={deshabilitado}
        value={nivelActual ? `h${nivelActual}` : "p"}
        onValueChange={(valor) => {
          if (valor === "p") editor.chain().focus().setParagraph().run();
          else editor.chain().focus().toggleHeading({ level: Number(valor.slice(1)) as 1 | 2 | 3 | 4 }).run();
        }}
        className="mr-1"
        options={[{ value: "p", label: "Text" }, ...[1, 2, 3, 4].map(level => ({ value: `h${level}`, label: `Heading ${level}` }))]}
      />

      <Boton etiqueta="Bold" deshabilitado={deshabilitado} activo={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold size={14} aria-hidden />
      </Boton>
      <Boton etiqueta="Italic" deshabilitado={deshabilitado} activo={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic size={14} aria-hidden />
      </Boton>
      <Boton etiqueta="Underline" deshabilitado={deshabilitado} activo={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <UnderlineIcon size={14} aria-hidden />
      </Boton>
      <Boton etiqueta="Strikethrough" deshabilitado={deshabilitado} activo={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Strikethrough size={14} aria-hidden />
      </Boton>

      <Separador />

      <Boton etiqueta="Bullet list" deshabilitado={deshabilitado} activo={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List size={14} aria-hidden />
      </Boton>
      <Boton etiqueta="Numbered list" deshabilitado={deshabilitado} activo={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered size={14} aria-hidden />
      </Boton>
      <Boton etiqueta="Block quote" deshabilitado={deshabilitado} activo={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        <Quote size={14} aria-hidden />
      </Boton>

      <Separador />

      {(["left", "center", "right"] as const).map((alineacion) => {
        const Icono = alineacion === "left" ? AlignLeft : alineacion === "center" ? AlignCenter : AlignRight;
        return (
          <Boton
            key={alineacion}
            etiqueta={`Align ${alineacion}`}
            deshabilitado={deshabilitado}
            activo={editor.isActive({ textAlign: alineacion })}
            onClick={() => {
              const tipo = editor.isActive("heading") ? "heading" : "paragraph";
              editor.chain().focus().updateAttributes(tipo, { textAlign: alineacion }).run();
            }}
          >
            <Icono size={14} aria-hidden />
          </Boton>
        );
      })}

      <Separador />

      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            type="button"
            disabled={deshabilitado}
            aria-label="Insert link"
            title="Insert link"
            className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-input)] text-text-muted hover:bg-surface-hover hover:text-text disabled:opacity-40"
          >
            <Link2 size={14} aria-hidden />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            sideOffset={6}
            className="z-50 flex w-[280px] flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-3 shadow-lg"
          >
            <label className="text-xs text-text-muted" htmlFor="editor-href">
              URL (HTTPS or internal path)
            </label>
            <input
              id="editor-href"
              value={href}
              onChange={(e) => setHref(e.target.value)}
              placeholder="https://"
              className="h-8 rounded-[var(--radius-input)] border border-border px-2 text-sm"
            />
            <div className="flex justify-end gap-2">
              <Popover.Close asChild>
                <button
                  type="button"
                  className="h-7 rounded-[var(--radius-input)] border border-border px-2 text-xs text-text-muted hover:bg-surface-hover"
                  onClick={() => editor.chain().focus().extendMarkRange("link").unsetLink().run()}
                >
                  Remove
                </button>
              </Popover.Close>
              <Popover.Close asChild>
                <button
                  type="button"
                  className="h-7 rounded-[var(--radius-input)] bg-primary px-2 text-xs text-white hover:bg-primary-hover"
                  onClick={() => {
                    if (!/^(https:\/\/|\/)/.test(href)) return;
                    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
                    setHref("");
                  }}
                >
                  Apply
                </button>
              </Popover.Close>
            </div>
            <p className="text-[11px] leading-tight text-text-subtle">
              Use an HTTPS link or an internal path.
            </p>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <Boton
        etiqueta="Insert table"
        deshabilitado={deshabilitado}
        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
      >
        <TableIcon size={14} aria-hidden />
      </Boton>

      <Separador />

      <Boton etiqueta="Undo" deshabilitado={deshabilitado || !editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
        <Undo2 size={14} aria-hidden />
      </Boton>
      <Boton etiqueta="Redo" deshabilitado={deshabilitado || !editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
        <Redo2 size={14} aria-hidden />
      </Boton>
    </div>
  );
}
