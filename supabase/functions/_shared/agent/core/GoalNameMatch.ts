// Casamento do nome citado pelo usuário com o nome de uma meta ("alimentacao",
// "Alimentação", "a meta de alimentação" → a meta de Alimentação). Puro e sem
// dependência de runtime para a ferramenta e os testes usarem a MESMA regra.

const STOP = /\b(?:meta|metas|de|da|do|das|dos|a|o|as|os|minha|minhas|meu|meus)\b/g;

export function foldGoalName(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(STOP, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function goalNameMatches(candidate: unknown, requested: unknown): boolean {
  const name = foldGoalName(candidate);
  const want = foldGoalName(requested);
  if (!name || !want) return false;
  return name === want || name.includes(want) || want.includes(name);
}
