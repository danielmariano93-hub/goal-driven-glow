import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/hb/ui";
import { AreaTile, RowCard, SectionLabel } from "@/components/hb/kit";
import { Switch } from "@/components/ui/switch";
import { hbErrorMessage, useGrantConsent, useHabitViews, useHbPrefs, useRevokeConsent, useSetHbMode, useSetHbPrefs } from "@/lib/habits/api";

const ITEMS: Array<{ tag: string; title: string; text: string }> = [
  { tag: "medido", title: "Contagem do que você marcou", text: "Constância, sequência e recorde. É só contar o que você registrou." },
  { tag: "estimado", title: "Força do hábito", text: "Dá mais peso aos últimos dias. Sobe com constância e cai devagar. É uma estimativa, não uma nota." },
  { tag: "autorrelatado", title: "O que você responde", text: "A cada 2 semanas o Nino pergunta o quanto o hábito está automático (1 a 7). Só você sabe. Quanto mais automático, menos lembretes." },
  { tag: "estimado", title: "Dinheiro que ficou com você", text: "Em hábitos de largar, é a sua média de gasto antes de começar menos o que você gastou depois. É uma estimativa, não um extrato." },
];

export default function Mais() {
  const navigate = useNavigate();
  const setMode = useSetHbMode();
  const { prefs } = useHbPrefs();
  const setPrefs = useSetHbPrefs();
  const { consent } = useHabitViews();
  const grant = useGrantConsent();
  const revoke = useRevokeConsent();
  const change = (patch: Parameters<typeof setPrefs.mutate>[0]) =>
    setPrefs.mutate(patch, { onError: (e) => toast.error(hbErrorMessage(e)) });
  return (
    <div className="px-4 pb-6">
      <PageHeader title="Mais" subtitle="Lembretes, privacidade e como o Nino Hábitos funciona" />

      <SectionLabel className="mt-2">Lembretes e WhatsApp</SectionLabel>
      <section className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60 bg-card shadow-card" aria-label="Lembretes e WhatsApp">
        <div className="flex items-center justify-between gap-4 p-4">
          <div className="min-w-0"><p id="hb-pref-nudges" className="text-[15px] font-medium">Lembretes dos meus hábitos</p><p className="mt-0.5 text-[13px] leading-[18px] text-muted-foreground">Até 2 por dia, só depois do horário combinado, sem passar das 22h. Se você ignorar 3 seguidos, eu paro.</p></div>
          <Switch aria-labelledby="hb-pref-nudges" checked={prefs.nudges_enabled} onCheckedChange={(v) => change({ nudges_enabled: v })} />
        </div>
        <div className="flex items-center justify-between gap-4 p-4">
          <div className="min-w-0"><p id="hb-pref-wa" className="text-[15px] font-medium">Marcar pelo WhatsApp</p><p className="mt-0.5 text-[13px] leading-[18px] text-muted-foreground">Mande “meditei”, “feito” ou “como estão meus hábitos?”. Para desfazer, “desfaz”.</p></div>
          <Switch aria-labelledby="hb-pref-wa" checked={prefs.whatsapp_logging} onCheckedChange={(v) => change({ whatsapp_logging: v })} />
        </div>
      </section>

      <SectionLabel>Privacidade</SectionLabel>
      <section className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-card" aria-label="Saúde e privacidade">
        <div className="flex items-center justify-between gap-4 p-4">
          <div className="min-w-0"><p id="hb-pref-consent" className="text-[15px] font-medium">Hábitos de saúde e substâncias</p><p className="mt-0.5 text-[13px] leading-[18px] text-muted-foreground">Autoriza o Nino a guardar e lembrar de hábitos como largar cigarro ou bebida. Só você vê. Pode retirar quando quiser.</p></div>
          <Switch aria-labelledby="hb-pref-consent" checked={consent} disabled={grant.isPending || revoke.isPending} onCheckedChange={(v) => (v ? grant : revoke).mutate(undefined, { onError: (e) => toast.error(hbErrorMessage(e)) })} />
        </div>
      </section>

      <SectionLabel>Dinheiro</SectionLabel>
      <Link to="/h/dinheiro" className="block">
        <RowCard lead={<AreaTile area="money" />} title="Hábitos e dinheiro" hint="O que o Nino mede pelos seus lançamentos e o que dá para ver junto com o gasto." />
      </Link>

      <SectionLabel>Como os números funcionam</SectionLabel>
      <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60 bg-card shadow-card">
        {ITEMS.map((i) => (
          <li key={i.title} className="p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="font-display text-[16px] font-semibold tracking-[-0.01em]">{i.title}</p>
              <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-0.5 text-[12px] font-medium text-primary">{i.tag}</span>
            </div>
            <p className="mt-1 text-[14px] leading-5 text-muted-foreground">{i.text}</p>
          </li>
        ))}
      </ul>

      <div className="mt-6 rounded-2xl bg-primary/5 p-5">
        <p className="font-display text-[17px] font-semibold tracking-[-0.01em]">Sem pontos, sem ranking</p>
        <p className="mt-1 text-[14px] leading-6 text-muted-foreground">Falhar um dia não quebra nada. O que importa é voltar. Um hábito costuma levar semanas ou meses para ficar automático, e varia muito de pessoa para pessoa.</p>
      </div>
      <Button variant="outline" className="mt-6 h-12 w-full rounded-full text-[15px] font-medium" onClick={() => { setMode.mutate("money"); navigate("/app"); }}>Voltar para o Nino Dinheiro</Button>
    </div>
  );
}
