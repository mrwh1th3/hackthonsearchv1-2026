import { NextResponse } from "next/server";
import { guardas } from "@/lib/document/servidor";
import { esUuid } from "@/lib/auditoria/runner";
import { readLab } from "@/lib/laboratorio/server";
import { askReport, readReportAnswers } from "@/lib/laboratorio/assistant";
import type { LabDetail } from "@/lib/laboratorio/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const headers = {"Cache-Control":"private, no-store"};
async function handle(req: Request, params: Promise<{id:string}>) {
  const gate = await guardas(req,"report-assistant",req.method === "POST" ? 8 : 60);
  if("error" in gate) return gate.error;
  const {id} = await params;
  if(!esUuid(id)) return NextResponse.json({error:"Invalid investigation ID."},{status:422,headers});
  const run = await readLab(id,gate.ok.session.perfil_id,true) as LabDetail | null;
  if(!run) return NextResponse.json({error:"Investigation unavailable."},{status:404,headers});
  if(req.method === "GET") return NextResponse.json({messages:await readReportAnswers(id)},{headers});
  const body = gate.ok.body as Record<string,unknown> | null;
  const index = body?.finding_index;
  const total = Array.isArray(run.engine?.findings) ? run.engine.findings.length : 0;
  if(!body || Object.keys(body).some(k => !["question","finding_index","request_id"].includes(k)) || typeof body.question !== "string" || !body.question.trim() || body.question.length > 2000 || !esUuid(body.request_id) || !(index === null || typeof index === "number" && Number.isInteger(index) && index >= 0 && index < total)) return NextResponse.json({error:"Choose a valid question and finding."},{status:422,headers});
  if(!run.engine) return NextResponse.json({error:"Wait for the first saved findings."},{status:409,headers});
  try { return NextResponse.json(await askReport(run,body.question.trim(),index as number|null,body.request_id),{headers}); }
  catch(error) { return NextResponse.json({error:error instanceof Error ? error.message : "The assistant is unavailable."},{status:503,headers}); }
}
export async function GET(req:Request,{params}:{params:Promise<{id:string}>}) {return handle(req,params);}
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}) {return handle(req,params);}
