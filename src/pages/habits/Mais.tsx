import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/hb/ui";
import { Switch } from "@/components/ui/switch";
import { hbErrorMessage, useHbPrefs, useSetHbMode, useSetHbPrefs } from "@/lib/habits/api";

const ITEMS: Array<{ tag: string; title: string; text: string }> = [
  { tag: "medido", title: "Contagem do que você marcou", text: "Dias cumpridos, sequência e recorde. É só contar o que você registrou." },
  { tag: "estimado", title: "Força do hábito", text: "Dá mais peso aos últimos dias. Sobe com constância e cai devagar. É uma estimativa, não uma nota." },
  { tag: "autorrelatado", title: "O que você responde", text: "Em breve o Nino vai perguntar o quanto o hábito está automático. Só você sabe." },
];

export default function Mais() {
  const navigate = useNavigate();
  const setMode = useSetHbMode();
  const { prefs } = useHbPrefs();
  const setPrefs = useSetHbPrefs();
  const change = (patch: Parameters<typeof setPrefs.mutate>[0]) =>
    setPrefs.mutate(patch, { onError: (e) => toast.error(hbErrorMessage(e)) });
  return (
    <div className="px-4 pb-6">
      <PageHeader title="Mais" subtitle="Como funciona o Nino Hábitos" />
      <section className="mb-4 rounded-[20px] bg-card p-4 shadow-card" aria-label="Lembretes e WhatsApp">
        <h2 className="font-display text-base font-bold">Lembretes e WhatsApp</h2>
        <div className="mt-3 flex items-center justify-between gap-4">
          <div className="min-w-0"><p id="hb-pref-nudges" className="text-[15px] font-semibold">Lembretes dos meus hábitos</p><p className="text-xs leading-4 text-muted-foreground">Até 2 por dia, só depois do horário combinado, sem passar das 22h. Se você ignorar 3 seguidos, eu paro.</p></div>
          <Switch aria-labelledby="hb-pref-nudges" checked={prefs.nudges_enabled} onCheckedChange={(v) => change({ nudges_enabled: v })} />
        </div>
        <div className="mt-4 flex items-center justify-between gap-4 border-t border-border pt-4">
          <div className="min-w-0"><p id="hb-pref-wa" className="text-[15px] font-semibold">Marcar pelo WhatsApp</p><p className="text-xs leading-4 text-muted-foreground">Mande “meditei”, “feito” ou “como estão meus hábitos?”. Para desfazer, “desfaz”.</p></div>
          <Switch aria-labelledby="hb-pref-wa" checked={prefs.whatsapp_logging} onCheckedChange={(v) => change({ whatsapp_logging: v })} />
        </div>
      </section>
      <ul className="flex flex-col gap-2">
        {ITEMS.map((i) => (
          <li key={i.title} className="rounded-[20px] bg-card p-4 shadow-card">
            <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">{i.tag}</span>
            <p className="mt-2 font-display text-base font-bold">{i.title}</p>
            <p className="mt-0.5 text-sm leading-5 text-muted-foreground">{i.text}</p>
          </li>
        ))}
      </ul>
      <div className="mt-5 rounded-[20px] bg-card p-4 shadow-card">
        <p className="font-display text-base font-bold">Sem pontos, sem ranking</p>
        <p className="mt-0.5 text-sm leading-5 text-muted-foreground">Falhar um dia não quebra nada. O que importa é voltar. Um hábito costuma levar semanas ou meses para ficar automático, e varia muito de pessoa para pessoa.</p>
      </div>
      <Button variant="outline" className="mt-5 h-12 w-full rounded-full text-[15px] font-semibold" onClick={() => { setMode.mutate("money"); navigate("/app"); }}>Voltar para o Nino Dinheiro</Button>
    </div>
  );
}
