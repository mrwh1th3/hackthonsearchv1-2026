# web — Next.js (App Router)

Dueño: **forense-webapp**, excepto `components/editor/`, `lib/document/` y `app/api/reportes/` (forense-editor). `package.json` y `package-lock.json` son del coordinador: pedir dependencias, no instalarlas.

Scripts: `npm run dev|build|typecheck|lint|test`. Tests con Vitest + Testing Library (`*.test.tsx`). Contratos: importar JSON desde `@contracts/schemas/*` (nunca `node:fs` en el navegador). Variables: ver `.env.example` en la raíz; el navegador solo recibe `NEXT_PUBLIC_*`.
