// Linha do tempo de importações do assessor: cada documento enviado (arquivo, WhatsApp ou sincronização
// do banco) vira UM cartão no ponto certo da conversa, com contexto e o que falta revisar.
// Funções puras — a leitura vem da RPC `assistant_import_timeline`.

export type TimelineDocRow = {
  id: string;
  source: string | null;
  status: string;
  document_kind: string | null;
  error: string | null;
  created_at: string;
  updated_at: string | null;
  statement_bank: string | null;
  period_start: string | null;
  period_end: string | null;
  counters: Record<string, unknown> | null;
  total: number;
  confirmed: number;
  ignored: number;
  pending: number;
  /** Lançamentos já gravados a partir do documento (inclui os de documentos cujos itens foram limpos). */
  registered?: number;
};

export type ImportCard = {
  document_id: string;
  createdAt: string;
  /** Status para a UI de revisão: com pendências é sempre `needs_review`. */
  status: string;
  title: string;
  text: string;
  pending: number;
  document_kind: string | null;
  error: string | null;
};

const ddmm = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const KIND_LABEL: Record<string, string> = {
  statement: "Extrato", invoice: "Fatura de cartão", receipt: "Recibo", list: "Lista de lançamentos",
};

function originLabel(doc: TimelineDocRow): string {
  if (doc.source === "open_finance") return "Sincronização com o banco";
  const kind = KIND_LABEL[String(doc.document_kind ?? "")] ?? "Documento";
  const bank = doc.statement_bank ? ` ${doc.statement_bank}` : "";
  const via = doc.source === "whatsapp" ? " (pelo WhatsApp)" : "";
  return `${kind}${bank}${via}`;
}

function periodLabel(doc: TimelineDocRow): string {
  return doc.period_start && doc.period_end ? ` · ${ddmm(doc.period_start)} a ${ddmm(doc.period_end)}` : "";
}

/** Cartão de um documento, ou null quando não vale mostrar (lote descartado, sincronização sem nada novo). */
export function describeImport(doc: TimelineDocRow): ImportCard | null {
  if (doc.status === "canceled") return null;
  const total = Number(doc.total) || 0;
  if (doc.source === "open_finance" && total === 0 && doc.status !== "failed") return null;

  const title = `${originLabel(doc)}${periodLabel(doc)}`;
  const base = { document_id: doc.id, createdAt: doc.created_at, title, document_kind: doc.document_kind, error: doc.error, pending: 0 };

  if (doc.status === "uploaded" || doc.status === "processing") {
    return { ...base, status: doc.status, text: `${title}\nEstou lendo o documento. Pode fechar esta tela: a revisão fica salva aqui.` };
  }
  if (doc.status === "failed") {
    return { ...base, status: "failed", text: `${title}\nNão consegui concluir a leitura. Você pode tentar de novo por partes.` };
  }
  if (doc.document_kind === "illegible") {
    return { ...base, status: doc.status, text: `${title}\nNão consegui ler bem esse documento. Se for PDF, confira se não tem senha; se for imagem, envie uma versão mais nítida.` };
  }
  if (doc.document_kind === "non_financial") {
    return { ...base, status: doc.status, text: `${title}\nEsse arquivo não parece ser um documento financeiro.` };
  }

  const registered = Math.max(Number(doc.confirmed) || 0, Number(doc.registered) || 0);
  const found = total || registered;
  if (found === 0 && doc.status === "confirmed") {
    return { ...base, status: "confirmed", text: `${title}\nImportação concluída.` };
  }
  if (found === 0) {
    return { ...base, status: doc.status, text: `${title}\nNão achei nenhum lançamento nesse documento.` };
  }

  const parts: string[] = [];
  if (registered > 0) parts.push(plural(registered, "registrado", "registrados"));
  if (doc.ignored > 0) parts.push(plural(doc.ignored, "ignorado", "ignorados"));
  if (doc.pending > 0) parts.push(`${doc.pending} aguardando revisão`);
  const breakdown = parts.length ? `\n${parts.join(" · ")}` : "";

  if (doc.pending > 0) {
    return {
      ...base, status: "needs_review", pending: doc.pending,
      text: `${title}\nEncontrei ${plural(found, "lançamento", "lançamentos")}.${breakdown}`,
    };
  }
  return { ...base, status: "confirmed", text: `${title}\nTudo revisado: ${parts.join(" · ") || `${found} lançamento(s)`}.` };
}

export function buildImportCards(rows: TimelineDocRow[] | null | undefined): ImportCard[] {
  return (rows ?? []).map(describeImport).filter((c): c is ImportCard => c !== null);
}

/** Intercala por data, mantendo a ordem original entre itens do mesmo instante. */
export function sortByTime<T extends { createdAt?: string }>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index, t: item.createdAt ? Date.parse(item.createdAt) : Number.POSITIVE_INFINITY }))
    .sort((a, b) => (a.t === b.t ? a.index - b.index : a.t - b.t))
    .map((x) => x.item);
}
