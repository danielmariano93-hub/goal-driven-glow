// Lê vários contatos colados de uma vez (lista do WhatsApp, notas, mensagem): "Nome 11 91234-5678", "Nome: +55 (11) 91234-5678",
// um por linha ou separados por ; e vírgula. Só devolve o que tem telefone brasileiro válido; o resto é contado como ignorado.
import { normalizeBrPhone } from "@/lib/phone";

export type ParsedContact = { name: string; phone_e164: string };
export type ParseResult = { contacts: ParsedContact[]; ignored: number };

const PHONE = /(?:\+?55[\s.-]*)?(?:\(?\d{2}\)?[\s.-]*)?9?\d{4}[\s.-]?\d{4}/;

const cleanName = (s: string) =>
  s.replace(/[:;|\-–—•*_>]+/g, " ").replace(/\s{2,}/g, " ").replace(/^[\s,.]+|[\s,.]+$/g, "").slice(0, 60);

export function parseContactsText(text: string): ParseResult {
  const lines = String(text ?? "").split(/\r?\n|;/).map((l) => l.trim()).filter(Boolean);
  const out: ParsedContact[] = [];
  const seen = new Set<string>();
  let ignored = 0;
  for (const line of lines) {
    // vírgula separa contatos só quando há mais de um telefone na linha
    const chunks = (line.match(new RegExp(PHONE.source, "g")) ?? []).length > 1 ? line.split(",") : [line];
    for (const chunk of chunks) {
      const m = chunk.match(PHONE);
      const phone = m ? normalizeBrPhone(m[0]) : null;
      if (!m || !phone) { if (chunk.trim()) ignored += 1; continue; }
      if (seen.has(phone)) continue;
      seen.add(phone);
      out.push({ phone_e164: phone, name: cleanName(chunk.replace(m[0], " ")) });
    }
  }
  return { contacts: out, ignored };
}
