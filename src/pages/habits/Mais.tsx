import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/hb/ui";
import { useSetHbMode } from "@/lib/habits/api";

const ITEMS: Array<{ tag: string; title: string; text: string }> = [
  { tag: "medido", title: "Contagem do que você marcou", text: "Dias cumpridos, sequência e recorde. É só contar o que você registrou." },
  { tag: "estimado", title: "Força do hábito", text: "Dá mais peso aos últimos dias. Sobe com constância e cai devagar. É uma estimativa, não uma nota." },
  { tag: "autorrelatado", title: "O que você responde", text: "Em breve o Nino vai perguntar o quanto o hábito está automático. Só você sabe." },
];

export default function Mais() {
  const navigate = useNavigate();
  const setMode = useSetHbMode();
  return (
    <div className="px-4 pb-6">
      <PageHeader title="Mais" subtitle="Como funciona o Nino Hábitos" />
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
