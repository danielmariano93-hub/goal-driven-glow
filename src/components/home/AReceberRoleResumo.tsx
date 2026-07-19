import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowRight, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { formatBRL } from "@/lib/engine/facts";

export function AReceberRoleResumo(){
 const{user}=useAuth();const{data}=useQuery({queryKey:["split-summary",user?.id],enabled:!!user,queryFn:async()=>{const{data,error}=await supabase.rpc("split_summary" as never);if(error)throw error;return ((data??[]) as any[])[0] as {total_received:number;total_pending:number;pending_people:number;active_splits:number}|undefined}});
 if(!data||(!Number(data.total_received)&&!Number(data.total_pending)))return null;
 return <Link to="/app/divisao-do-role" className="surface-card block p-4 transition-colors hover:border-primary/30"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary"><Users size={18}/></div><div className="min-w-0 flex-1"><p className="text-sm font-semibold">A receber dos rolês</p><p className="text-xs text-muted-foreground">{data.pending_people} pessoa{Number(data.pending_people)===1?"":"s"} ainda vai pagar</p></div><ArrowRight size={16} className="text-muted-foreground"/></div><div className="mt-4 grid grid-cols-3 gap-2"><Metric label="Total recebido" value={formatBRL(Number(data.total_received))} tone="text-success"/><Metric label="Ainda falta" value={formatBRL(Number(data.total_pending))} tone="text-destructive"/><Metric label="Em andamento" value={String(data.active_splits)}/></div></Link>
}
function Metric({label,value,tone=""}:{label:string;value:string;tone?:string}){return <div><p className="text-[10px] text-muted-foreground">{label}</p><p className={`text-xs font-bold ${tone}`}>{value}</p></div>}
