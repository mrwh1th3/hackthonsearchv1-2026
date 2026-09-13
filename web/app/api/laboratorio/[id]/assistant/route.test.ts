// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({guardas:vi.fn(),readLab:vi.fn(),askReport:vi.fn(),readReportAnswers:vi.fn()}));
vi.mock("@/lib/document/servidor",()=>({guardas:mocks.guardas}));
vi.mock("@/lib/laboratorio/server",()=>({readLab:mocks.readLab}));
vi.mock("@/lib/laboratorio/assistant",()=>({askReport:mocks.askReport,readReportAnswers:mocks.readReportAnswers}));
import {GET,POST} from "./route";
const id="00000000-0000-4000-8000-000000000901";
const params=Promise.resolve({id});
const run={engine:{findings:[{subject_name:"Vendor"}]}};
const body={question:"Explain the evidence",finding_index:0,request_id:id};
beforeEach(()=>{vi.resetAllMocks();mocks.guardas.mockResolvedValue({ok:{session:{perfil_id:"owner"},body}});mocks.readLab.mockResolvedValue(run);mocks.askReport.mockResolvedValue({answer:"Saved answer",references:[]});mocks.readReportAnswers.mockResolvedValue([]);});
describe("private report assistant",()=>{
 it("checks ownership before launching a model",async()=>{mocks.readLab.mockResolvedValue(null);expect((await POST(new Request('http://localhost/api',{method:'POST'}),{params})).status).toBe(404);expect(mocks.askReport).not.toHaveBeenCalled();expect(mocks.readLab).toHaveBeenCalledWith(id,"owner",true);});
 it("rejects a selected finding outside this run",async()=>{mocks.guardas.mockResolvedValue({ok:{session:{perfil_id:"owner"},body:{...body,finding_index:10}}});expect((await POST(new Request('http://localhost/api',{method:'POST'}),{params})).status).toBe(422);expect(mocks.askReport).not.toHaveBeenCalled();});
 it("dispatches the question with a server-owned run",async()=>{expect((await POST(new Request('http://localhost/api',{method:'POST'}),{params})).status).toBe(200);expect(mocks.askReport).toHaveBeenCalledWith(run,body.question,0,id);});
 it("reads saved conversation without model calls",async()=>{const response=await GET(new Request('http://localhost/api'),{params});expect(await response.json()).toEqual({messages:[]});expect(mocks.askReport).not.toHaveBeenCalled();});
});
