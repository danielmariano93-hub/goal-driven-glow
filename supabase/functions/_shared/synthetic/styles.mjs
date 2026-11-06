// Estilos de escrita do usuário sintético. Transformações determinísticas (sem IA) aplicadas à pergunta
// "limpa" do cenário. Números, valores e nomes de mês/categoria nunca são alterados, para o gabarito
// continuar valendo. A parte generativa (paráfrase por IA) é opcional e fica no runner (`--llm`).
import { rng } from "./personas.mjs";

export const STYLES = ["neutro", "informal", "erros", "telegrafico", "prolixo", "apressado", "audio"];

const PROTECT = /\d|janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|mercado|moradia|lazer|transporte|alimenta|saúde|assinatura|pets?|educa|vestu|serviç|nino|ifood|uber|netflix|r\$/i;

function typo(word, r) {
  if (word.length < 6 || PROTECT.test(word)) return word;
  const i = 1 + Math.floor(r() * (word.length - 3));
  const mode = r();
  if (mode < 0.4) return word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2); // troca
  if (mode < 0.7) return word.slice(0, i) + word.slice(i + 1); // some letra
  return word.slice(0, i) + word[i] + word.slice(i); // repete letra
}

const INFORMAL = [[/\bvocê\b/gi, "vc"], [/\bque\b/gi, "q"], [/\bquanto\b/gi, "qnto"], [/\bpara\b/gi, "pra"], [/\btambém\b/gi, "tb"], [/\bmuito\b/gi, "mt"], [/\bnão\b/gi, "n"], [/\bestou\b/gi, "to"], [/\bcomigo\b/gi, "cmg"]];

export function applyStyle(text, style, seed = "") {
  const r = rng(`${style}:${seed}:${text}`);
  const raw = String(text);
  switch (style) {
    case "informal": {
      let s = raw.toLowerCase().replace(/[?!.,]+/g, "");
      for (const [re, to] of INFORMAL) if (r() < 0.8) s = s.replace(re, to);
      return s.trim();
    }
    case "erros":
      return raw.split(" ").map((w) => (r() < 0.45 ? typo(w, r) : w)).join(" ");
    case "telegrafico":
      return raw.toLowerCase().replace(/\b(quanto|qual|que|eu|meu|minha|me diz|me diga|por favor|pode|você|vc|nino)\b/g, "").replace(/[?!.,]+/g, "").replace(/\s+/g, " ").trim() || raw;
    case "prolixo": {
      const pre = ["Oi Nino, tudo bem? Então, queria saber uma coisa: ", "Bom dia! Desculpa incomodar, mas ", "Opa, eu estava aqui pensando e queria te perguntar: "][Math.floor(r() * 3)];
      const post = [" Se puder me explicar direitinho eu agradeço!", " Obrigado desde já.", " É pra eu me organizar melhor."][Math.floor(r() * 3)];
      return pre + raw.charAt(0).toLowerCase() + raw.slice(1) + post;
    }
    case "apressado":
      return `${raw.replace(/[?.]+$/, "")} rápido pfv`;
    case "audio":
      return ["é... então, ", "tipo assim, ", "ahn, "][Math.floor(r() * 3)] + raw.toLowerCase().replace(/[?!.,]+/g, "") + " sabe";
    default:
      return raw;
  }
}
