import { redirect } from "next/navigation";
import { esUuid } from "@/lib/auditoria/runner";

export const metadata = { title: "Inspector · Investigation" };
export const dynamic = "force-dynamic";

export default async function LaboratorioPage({ searchParams }: { searchParams: Promise<{ run?: string; corrida?: string }> }) {
  const params = await searchParams;
  const query = new URLSearchParams();
  if (esUuid(params.corrida)) query.set("corrida", params.corrida);
  if (esUuid(params.run)) query.set("run", params.run);
  redirect(query.size ? `/?${query}` : "/");
}
