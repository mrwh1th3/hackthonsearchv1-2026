import {fireEvent,render,screen,waitFor,within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {afterAll,afterEach,beforeAll,expect,it,vi} from "vitest";
import {InvestigationDocument} from "./investigation-document";
vi.mock("./report-chat",()=>({ReportChat:({onAsk,contextLabel}:{onAsk:(q:string)=>Promise<unknown>;contextLabel:string})=><aside aria-label="Report chat"><span>{contextLabel}</span><button onClick={()=>void onAsk("Explain it")}>Ask assistant</button></aside>}));
vi.mock("@/app/(app)/laboratorio/laboratorio",()=>({Trace:()=>null,Value:()=>null}));
const id="00000000-0000-4000-8000-000000000901";
const data={launch:{run_id:id,corrida_id:id,corrida_nombre:"Estate 105",provider:"codex",status:"completed",started_at:"2026-09-13T08:00:00Z",total_duration_ms:60000},summary:{stages:[]},engine:{findings:[{subject_name:"Vendor One",scheme_type:"round_tripping",peso_amount:100,narrative:"A payment returned to the company.",entities:["RFC:ONE"],exhibits:[{exhibit_id:"EX-1",source_table:"bank_txns",record_id:"BANK-1",note:"The return payment."}]}],leads:[]},agent_a:{reviews:[]},agent_b:{findings:[]},traces:[],proposals:[],notes:[]};
const originalScrollIntoView=Object.getOwnPropertyDescriptor(HTMLElement.prototype,"scrollIntoView");
beforeAll(()=>Object.defineProperty(HTMLElement.prototype,"scrollIntoView",{configurable:true,value:vi.fn()}));
afterAll(()=>{if(originalScrollIntoView)Object.defineProperty(HTMLElement.prototype,"scrollIntoView",originalScrollIntoView);else Reflect.deleteProperty(HTMLElement.prototype,"scrollIntoView");});
afterEach(()=>vi.unstubAllGlobals());
function setup(report=data){const request=vi.fn().mockImplementation(async(url:string,init?:RequestInit)=>({ok:true,json:async()=>init?.method==='POST'?{answer:"Evidence explanation",references:[]} :url.endsWith('/assistant')?{messages:[]}:url.includes('/entrega')?{expediente:true}:report}));vi.stubGlobal("fetch",request);render(<InvestigationDocument runId={id}/>);return request;}
it("opens a paper report with an assistant and reveals evidence on demand",async()=>{setup();await screen.findByRole("heading",{name:"Investigation overview"});expect(screen.getByRole("navigation",{name:"Report contents"})).toBeInTheDocument();fireEvent.click(screen.getByRole("button",{name:/01\s*Vendor One/}));expect(screen.getByRole("heading",{name:"Vendor One"})).toBeInTheDocument();expect(screen.queryByRole("dialog")).not.toBeInTheDocument();fireEvent.click(screen.getByRole("button",{name:/EX-1\s*bank_txns/}));expect(screen.getByRole("dialog",{name:"Evidence reference"})).toHaveTextContent("BANK-1");});
it("passes only the selected finding index to the report assistant",async()=>{const request=setup();await screen.findByRole("heading",{name:"Investigation overview"});fireEvent.click(screen.getByRole("button",{name:/01\s*Vendor One/}));fireEvent.click(screen.getByRole("button",{name:"Ask assistant"}));await waitFor(()=>expect(request).toHaveBeenCalledWith(`/api/laboratorio/${id}/assistant`,expect.objectContaining({method:"POST"})));const call=request.mock.calls.find(c=>c[1]?.method==='POST')!;expect(JSON.parse(call[1].body)).toMatchObject({finding_index:0,question:"Explain it"});expect(JSON.parse(call[1].body)).not.toHaveProperty('evidence');});

it("does not mark unfinished steps complete when a run failed",async()=>{setup({...data,launch:{...data.launch,status:"failed"},engine:null,agent_a:null,agent_b:null} as unknown as typeof data);await screen.findByRole("heading",{name:"Investigation overview"});expect(screen.getByRole("button",{name:"Rule checks: Waiting for results"})).toBeInTheDocument();expect(screen.getByRole("button",{name:"A/B review: Interrupted"})).toBeInTheDocument();});

it("opens report actions with the keyboard, preserves downloads, and restores focus on Escape",async()=>{
  const user=userEvent.setup();setup();
  await screen.findByRole("heading",{name:"Investigation overview"});
  const trigger=screen.getByRole("button",{name:"Report actions"});
  trigger.focus();await user.keyboard("{Enter}");
  expect(await screen.findByRole("menu")).toBeInTheDocument();
  expect(screen.getByRole("menuitem",{name:"Download full report"})).toHaveAttribute("href",`/api/laboratorio/${id}/entrega?tipo=expediente`);
  expect(screen.getByRole("menuitem",{name:"Judge submission"})).toHaveAttribute("href",`/api/laboratorio/${id}/entrega?tipo=submission`);
  expect(screen.getByRole("menuitem",{name:"Judge submission"})).toHaveAttribute("download");
  await user.keyboard("{Escape}");
  await waitFor(()=>expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  expect(trigger).toHaveFocus();
});

it("closes report actions when clicking outside the menu",async()=>{
  const user=userEvent.setup();setup();
  const heading=await screen.findByRole("heading",{name:"Investigation overview"});
  await user.click(screen.getByRole("button",{name:"Report actions"}));
  expect(await screen.findByRole("menu")).toBeInTheDocument();
  await user.click(heading);
  await waitFor(()=>expect(screen.queryByRole("menu")).not.toBeInTheDocument());
});

it("starts another investigation from report actions and surfaces restart errors",async()=>{
  const user=userEvent.setup();const request=setup();
  await screen.findByRole("heading",{name:"Investigation overview"});
  await user.click(screen.getByRole("button",{name:"Report actions"}));
  await user.click(await screen.findByRole("menuitem",{name:"Run again"}));
  await waitFor(()=>expect(request).toHaveBeenCalledWith("/api/laboratorio",expect.objectContaining({method:"POST"})));
  const call=request.mock.calls.find(([url])=>url==="/api/laboratorio")!;
  expect(JSON.parse(call[1].body)).toEqual({corrida_id:id,mensaje:"",provider:"codex"});
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not restart.");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(screen.getByRole("button",{name:"Report actions"})).toBeEnabled();
});

it("keeps active investigations from being restarted",async()=>{
  const user=userEvent.setup();setup({...data,launch:{...data.launch,status:"running"}});
  await screen.findByRole("heading",{name:"Investigation overview"});
  await user.click(screen.getByRole("button",{name:"Report actions"}));
  expect(await screen.findByRole("menu")).toHaveTextContent("Downloads appear after the report is saved.");
  expect(screen.queryByRole("menuitem",{name:"Run again"})).not.toBeInTheDocument();
});

it("switches report sections through the branded selector",async()=>{
  const user=userEvent.setup();setup();
  await screen.findByRole("heading",{name:"Investigation overview"});
  const select=screen.getByRole("combobox",{name:"Report section"});
  select.focus();await user.keyboard("{Enter}");
  expect(await screen.findByRole("option",{name:"Findings"})).toBeInTheDocument();
  await user.keyboard("{ArrowDown}{Enter}");
  expect(await screen.findByRole("heading",{name:"Findings"})).toBeInTheDocument();
  expect(select).toHaveTextContent("Findings");
});

it("shows whole-workflow usage and duration on the overview before opening technical details",async()=>{
  const report={...data,launch:{...data.launch,total_duration_ms:120500},engine:{...data.engine,run_metadata:{llm_calls:0,mxn_cost:0,wall_clock_seconds:.15}},summary:{...data.summary,llm_calls:6,total_tokens_in:200,total_tokens_out:30,sector_research:{calls:1,tokens_in:50,tokens_out:5,tokens_estimated:true}}};
  setup(report);await screen.findByRole("heading",{name:"Investigation overview"});
  expect(screen.getByLabelText("Whole-investigation timing")).toHaveTextContent("120.500 wall-clock seconds");
  const usage=within(screen.getByLabelText("Whole-workflow usage"));
  expect(usage.getByText("7")).toBeInTheDocument();
  expect(usage.getByText("285")).toBeInTheDocument();
  expect(usage.getByText("Estimated tokens")).toBeInTheDocument();
  expect(usage.getByText("Not itemized")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:/Leads investigated & closed/}));
  expect(screen.getByRole("heading",{name:/Why these leads/})).toBeInTheDocument();
});

it("surfaces an unavailable full report without discarding saved findings",async()=>{
  const report={...data,launch:{...data.launch,error:"The full report is unavailable. Saved investigation results remain available."}};
  setup(report);
  await screen.findByRole("heading",{name:"Investigation overview"});
  expect(screen.getByRole("status")).toHaveTextContent("The full report is unavailable.");
  expect(screen.getByRole("button",{name:/01\s*Vendor One/})).toBeInTheDocument();
});
