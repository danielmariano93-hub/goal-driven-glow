import { describe, expect, it } from "vitest";
import { parseContactsText } from "@/lib/split/parseContacts";

describe("colar vários contatos", () => {
  it("nome + telefone em formatos comuns, um por linha", () => {
    const r = parseContactsText("Roger 11 98426-5698\nLucas: +55 (11) 97707-9909\nMaria - 11977079910");
    expect(r.contacts).toEqual([
      { name: "Roger", phone_e164: "+5511984265698" },
      { name: "Lucas", phone_e164: "+5511977079909" },
      { name: "Maria", phone_e164: "+5511977079910" },
    ]);
    expect(r.ignored).toBe(0);
  });
  it("separa por ponto e vírgula e por vírgula entre contatos; ignora repetidos e linhas sem telefone", () => {
    const r = parseContactsText("Ana 11 91111-2222; Beto 11 93333-4444, Caio 11 95555-6666\nAna 11911112222\nsó texto");
    expect(r.contacts.map((c) => c.name)).toEqual(["Ana", "Beto", "Caio"]);
    expect(r.ignored).toBe(1);
  });
  it("número sem nome entra com nome vazio; inválido é ignorado", () => {
    const r = parseContactsText("11 91234-5678\n12345");
    expect(r.contacts).toEqual([{ name: "", phone_e164: "+5511912345678" }]);
    expect(r.ignored).toBe(1);
  });
});

import { readFileSync } from "node:fs";
describe("fiação no formulário do rolê", () => {
  it("atalhos de rolês anteriores/colar vários ficam ao lado do botão de contatos; dica explica o iPhone", () => {
    const form = readFileSync("src/pages/DivisaoDoRoleNova.tsx", "utf8");
    expect(form).toContain("<QuickAddPeople");
    expect(form).toContain("<ContactPickerButton");
    expect(readFileSync("src/components/contacts/ContactPickerButton.tsx", "utf8")).toContain("O iPhone não deixa");
  });
});
