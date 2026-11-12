// Catálogo de hábitos: o que a pessoa vê ao escolher uma sugestão. Cada item já sabe como se mede (forma) e o que é razoável por padrão.
// O nome NUNCA carrega a meta ("Beber água", não "Beber 2 L"): a meta mora na medida e muda sem mexer no nome.
import type { HabitForm } from "@/lib/habits/engine";
import type { HbArea } from "@/lib/habits/api";

export type IconKey = "sun" | "activity" | "heart" | "book" | "drop" | "moon" | "phone" | "bag" | "smoke" | "coin" | "list" | "calendar" | "clock" | "brain" | "home" | "pen";

export interface MeasureOption {
  form: HabitForm;
  label: string;
  /** Texto abaixo do número ("minutos por dia", "deitar até às __h"). `__` vira o valor. */
  unit: string;
  target: number;
  step: number;
  min?: number;
  max?: number;
}

export interface CatalogItem {
  id: string;
  label: string;
  area: HbArea;
  icon: IconKey;
  cue?: string;
  minimum?: string;
  /** Primeira opção é a padrão. Sem opções = só "feito ou não". */
  options: MeasureOption[];
  /** Rotina em passos: sugestões iniciais. */
  steps?: string[];
  /** Projeto: unidade ("páginas", "R$", "aulas") e rótulos. */
  project?: { unit: string; titleLabel: string; totalLabel: string; example: string };
  sensitive?: boolean;
  /**
   * Fora das sugestões (a pessoa ainda pode criar escrevendo o nome). Critério: sugerimos hábitos que mudam a vida (comportamentos
   * com efeito real e evidência), não resultados nem tarefas de um passo só. Ficam no catálogo para o ícone e a busca por nome.
   * - resultados e medidas (peso, horas de sono, humor): são metas e medidas, e vivem num Objetivo, não numa tarefa diária;
   * - tarefas triviais (vitamina, arrumar a cama, alongar) e manutenção doméstica (filtro, carro).
   */
  hidden?: boolean;
}

const CHECK: MeasureOption = { form: "check", label: "Feito ou não", unit: "", target: 0, step: 1 };
const mins = (target: number, step = 5, label = "Minutos por dia"): MeasureOption => ({ form: "duration", label, unit: label.includes("sessão") ? "minutos por sessão" : "minutos por dia", target, step });
const perWeek = (target: number): MeasureOption => ({ form: "weekly", label: "Vezes na semana", unit: "vezes por semana", target, step: 1, min: 1, max: 7 });

export const CATALOG: CatalogItem[] = [
  // Corpo
  { id: "caminhar", label: "Caminhar", area: "body", icon: "activity", cue: "Tarde · depois do almoço", minimum: "Caminhar 5 minutos", options: [mins(20), CHECK, { form: "amount", label: "Passos", unit: "passos por dia", target: 6000, step: 500 }] },
  { id: "treinar", label: "Treinar", area: "body", icon: "heart", cue: "Noite · depois do trabalho", minimum: "Fazer 10 minutos", options: [perWeek(3), mins(40, 5, "Minutos por sessão"), CHECK] },
  { id: "agua", label: "Beber água", area: "body", icon: "drop", cue: "Durante o dia", minimum: "Mais 1 copo", options: [{ form: "amount", label: "Litros", unit: "litros por dia", target: 2, step: 0.5, min: 0.5, max: 8 }, { form: "amount", label: "Copos", unit: "copos por dia", target: 8, step: 1, min: 1, max: 30 }] },
  { id: "dormir", label: "Dormir cedo", area: "body", icon: "moon", cue: "Noite · depois de escovar os dentes", minimum: "Deitar 15 minutos mais cedo", options: [{ form: "time", label: "Horário", unit: "deitar até às __h", target: 23, step: 1, min: 20, max: 24 }, CHECK] },
  { id: "acordar", label: "Acordar cedo", area: "routine", icon: "sun", cue: "Manhã · ao acordar", minimum: "Acordar 10 minutos mais cedo", options: [{ form: "time", label: "Horário", unit: "acordar até às __h", target: 7, step: 1, min: 4, max: 11 }, CHECK] },
  { id: "alongar", hidden: true, label: "Alongar", area: "body", icon: "activity", cue: "Manhã · ao acordar", minimum: "Alongar 1 minuto", options: [CHECK, mins(10, 5)] },
  { id: "vitamina", hidden: true, label: "Tomar vitamina", area: "body", icon: "heart", cue: "Manhã · depois do café", options: [CHECK] },
  { id: "peso", hidden: true, label: "Acompanhar o peso", area: "body", icon: "activity", cue: "Manhã · ao acordar", sensitive: true, options: [{ form: "value", label: "Peso (kg)", unit: "quilos", target: 70, step: 0.5, min: 20, max: 300 }] },
  { id: "sono", hidden: true, label: "Horas de sono", area: "body", icon: "moon", cue: "Manhã · ao acordar", options: [{ form: "value", label: "Horas dormidas", unit: "horas", target: 7.5, step: 0.5, min: 1, max: 14 }] },
  // Mente
  { id: "meditar", label: "Meditar", area: "mind", icon: "sun", cue: "Manhã · depois do café", minimum: "3 respirações", options: [mins(5, 1), CHECK] },
  { id: "ler", label: "Ler", area: "mind", icon: "book", cue: "Noite · antes de dormir", minimum: "Ler 1 página", options: [{ form: "project", label: "Um livro", unit: "páginas por dia", target: 10, step: 5, min: 1 }, { form: "amount", label: "Páginas por dia", unit: "páginas por dia", target: 10, step: 5, min: 1 }, mins(20, 5), CHECK], project: { unit: "páginas", titleLabel: "Qual livro?", totalLabel: "Quantas páginas tem?", example: "Título do livro" } },
  { id: "gratidao", label: "Diário de gratidão", area: "mind", icon: "pen", cue: "Noite · antes de dormir", minimum: "Uma frase", options: [CHECK] },
  { id: "estudar", label: "Estudar idioma", area: "mind", icon: "brain", cue: "Manhã · depois do café", minimum: "5 minutos", options: [mins(15, 5), CHECK] },
  { id: "curso", label: "Fazer um curso", area: "mind", icon: "brain", cue: "Noite · depois do trabalho", minimum: "Uma aula curta", options: [{ form: "project", label: "Um curso", unit: "aulas por dia", target: 1, step: 1, min: 1 }, CHECK], project: { unit: "aulas", titleLabel: "Qual curso?", totalLabel: "Quantas aulas tem?", example: "Nome do curso" } },
  { id: "foco", label: "Foco profundo", area: "mind", icon: "brain", cue: "Manhã", minimum: "25 minutos", options: [mins(90, 15), CHECK] },
  { id: "tela", label: "Tempo de tela", area: "mind", icon: "phone", cue: "Noite", options: [{ form: "ceiling", label: "Horas no máximo", unit: "horas por dia, no máximo", target: 3, step: 0.5, min: 0.5, max: 12 }] },
  { id: "humor", hidden: true, label: "Como me sinto", area: "mind", icon: "heart", cue: "Noite", options: [{ form: "value", label: "Humor de 1 a 5", unit: "de 1 a 5", target: 4, step: 1, min: 1, max: 5 }] },
  // Rotina
  { id: "cama", hidden: true, label: "Arrumar a cama", area: "routine", icon: "home", cue: "Manhã · ao acordar", options: [CHECK] },
  { id: "manha", label: "Rotina da manhã", area: "routine", icon: "list", cue: "Manhã · ao acordar", minimum: "Só o primeiro passo", options: [{ form: "steps", label: "Passos", unit: "", target: 0, step: 1 }], steps: ["Beber água", "Arrumar a cama", "Alongar", "Tomar café sem celular"] },
  { id: "noite", label: "Rotina da noite", area: "routine", icon: "list", cue: "Noite · depois do jantar", minimum: "Só o primeiro passo", options: [{ form: "steps", label: "Passos", unit: "", target: 0, step: 1 }], steps: ["Deixar a roupa separada", "Escovar os dentes", "Ler 5 minutos"] },
  { id: "planejar", label: "Planejar o dia", area: "routine", icon: "calendar", cue: "Manhã", minimum: "Uma prioridade", options: [CHECK] },
  { id: "ligar", label: "Ligar para a família", area: "routine", icon: "phone", cue: "Durante o dia · no fim de semana", options: [perWeek(2), CHECK] },
  { id: "cozinhar", label: "Cozinhar em casa", area: "routine", icon: "home", cue: "Noite · na hora do jantar", options: [perWeek(4), CHECK] },
  // Dinheiro
  { id: "registrar", label: "Registrar os gastos do dia", area: "money", icon: "coin", cue: "Noite", minimum: "Só os maiores", options: [CHECK] },
  { id: "fatura", label: "Revisar a fatura", area: "money", icon: "coin", cue: "Durante o dia · no domingo", options: [perWeek(1)] },
  { id: "reserva", label: "Guardar para uma meta", area: "money", icon: "coin", cue: "Durante o dia · quando o salário cair", options: [{ form: "project", label: "Uma meta em R$", unit: "R$ por vez", target: 100, step: 50, min: 10 }], project: { unit: "R$", titleLabel: "Qual é a meta?", totalLabel: "Quanto quer juntar (R$)?", example: "Viagem, reserva…" } },
  { id: "teto-delivery", label: "Limitar delivery", area: "money", icon: "bag", cue: "Durante o dia", options: [{ form: "ceiling", label: "Pedidos por dia, no máximo", unit: "pedidos por dia, no máximo", target: 0, step: 1, min: 0, max: 5 }] },
  // Cuidados
  { id: "consulta", label: "Consulta médica", area: "body", icon: "calendar", options: [{ form: "recurring", label: "Repetir a cada", unit: "dias", target: 365, step: 30, min: 7, max: 3650 }] },
  { id: "dentista", label: "Dentista", area: "body", icon: "calendar", options: [{ form: "recurring", label: "Repetir a cada", unit: "dias", target: 180, step: 30, min: 7, max: 3650 }] },
  { id: "filtro", hidden: true, label: "Trocar o filtro da água", area: "routine", icon: "home", options: [{ form: "recurring", label: "Repetir a cada", unit: "dias", target: 180, step: 30, min: 7, max: 3650 }] },
  { id: "carro", hidden: true, label: "Revisão do carro", area: "routine", icon: "calendar", options: [{ form: "recurring", label: "Repetir a cada", unit: "dias", target: 365, step: 30, min: 7, max: 3650 }] },
];

export interface QuitItem { id: string; label: string; area: HbArea; icon: IconKey; plan: string; sensitivity: "normal" | "substance" }
export const QUIT_CATALOG: QuitItem[] = [
  { id: "q-delivery", label: "Delivery por impulso", area: "money", icon: "bag", plan: "Beber água e esperar 10 minutos", sensitivity: "normal" },
  { id: "q-redes", label: "Redes antes de dormir", area: "mind", icon: "phone", plan: "Deixar o celular carregando fora da cama", sensitivity: "normal" },
  { id: "q-compras", label: "Compras por impulso", area: "money", icon: "bag", plan: "Esperar 24 horas antes de comprar", sensitivity: "normal" },
  { id: "q-acucar", label: "Açúcar", area: "body", icon: "heart", plan: "Beber água e comer uma fruta", sensitivity: "normal" },
  { id: "q-cigarro", label: "Cigarro", area: "body", icon: "smoke", plan: "Respirar fundo e esperar 10 minutos", sensitivity: "substance" },
  { id: "q-bebida", label: "Bebida alcoólica", area: "body", icon: "smoke", plan: "Avisar alguém de confiança e sair para uma caminhada", sensitivity: "substance" },
];

// Os atalhos do primeiro acesso usam o "slug" dos modelos do servidor (ex.: agua-2l).
const SLUG_TO_ID: Record<string, string> = {
  "agua-2l": "agua", "caminhar-20": "caminhar", "meditar-5": "meditar", "ler-10": "ler",
  "dormir-23": "dormir", "treinar-3x": "treinar",
};
export const findCatalog = (id: string): CatalogItem | undefined => {
  const key = SLUG_TO_ID[id] ?? id;
  return CATALOG.find((c) => c.id === key);
};

/** Ícone de um hábito já criado: pelo item do catálogo com o mesmo nome; senão por palavras do nome; senão pela forma de medir. */
export function habitIconKey(title: string, form: string, area: string): IconKey {
  const t = title.trim().toLowerCase();
  const hit = CATALOG.find((c) => c.label.toLowerCase() === t) ?? QUIT_CATALOG.find((c) => c.label.toLowerCase() === t);
  if (hit) return hit.icon;
  if (/[áa]gua|beber|hidrat/.test(t)) return "drop";
  if (/ler|livro|leitura|estud|curso|idioma/.test(t)) return /ler|livro|leitura/.test(t) ? "book" : "brain";
  if (/dorm|sono|deitar/.test(t)) return "moon";
  if (/acord|manh/.test(t)) return "sun";
  if (/medit|respir|foco|mente/.test(t)) return "brain";
  if (/trein|academia|corrida|correr|caminh|exerc|alonga/.test(t)) return "heart";
  if (/tela|celular|redes/.test(t)) return "phone";
  if (/gasto|fatura|poupar|guardar|dinheiro|delivery/.test(t)) return "coin";
  if (/cozinh|casa|arrum|filtro/.test(t)) return "home";
  switch (form) {
    case "recurring": return "calendar";
    case "steps": return "list";
    case "time": return "clock";
    case "project": return "book";
    case "ceiling": return "phone";
    case "weekly": return "heart";
    case "value": return "activity";
  }
  return area === "mind" ? "brain" : area === "money" ? "coin" : area === "routine" ? "sun" : "activity";
}
