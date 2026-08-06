import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { formatPrivateBRL, setFinancialValuesHidden } from "@/lib/privacy";
import { formatBRL } from "@/lib/engine/facts";

const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");

describe("composição narrativa da Home", () => {
  it("mantém as seções na ordem agora, ação, orientação, comportamento e futuro", () => {
    const source = read("src/pages/Index.tsx");
    const markers = [
      "<HomeHeader",
      "<HeroDisponivelCard",
      "<QuickActions",
      "<NinoGuidanceCard",
      "<RitmoUnificadoCard",
      "<PrevisaoFechamentoCard",
      "<ProximosCompromissosCard",
      "<EmotionalCheckinCard",
    ];
    const positions = markers.map((marker) => source.indexOf(marker));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("usa o diagnóstico completo, não o item editorial legado", () => {
    const source = read("src/pages/Index.tsx");
    expect(source).toContain("useNinoDiagnosisContext");
    expect(source).toContain("toHomeDiagnosisView");
    expect(source).not.toContain("useNinoHomeItem");
  });

  it("não converte indisponibilidade complementar em zero sem checar capacidade", () => {
    const source = read("src/pages/Index.tsx");
    expect(source).toContain('availability.projection === "available"');
    expect(source).toContain('availability.cardExposure === "available"');
    expect(source).toContain("projectionAvailability={availability.projection}");
  });

  it("aplica a identidade oficial na Home", () => {
    const theme = read("tailwind.config.ts");
    const files = [
      "src/components/home/HomeHeader.tsx",
      "src/components/home/PeriodPicker.tsx",
      "src/components/home/HeroDisponivelCard.tsx",
      "src/components/home/RitmoUnificadoCard.tsx",
      "src/components/home/NinoGuidanceCard.tsx",
      "src/components/home/AvailableBalanceDetails.tsx",
      "src/components/home/RhythmMethodSheet.tsx",
      "src/components/home/QuickActions.tsx",
      "src/components/home/EmotionalCheckinCard.tsx",
    ].map(read).join("\n");
    const css = read("src/index.css");
    const head = read("index.html");
    expect(theme).toContain('"DM Sans"');
    expect(head).toContain("family=Inter");
    expect(head).toContain("family=Manrope");
    expect(css).toContain("[data-surface=\"home\"]");
    expect(css).toContain("font-family: 'Inter'");
    expect(css).toContain("font-family: 'Manrope'");
    expect(files).toContain("@phosphor-icons/react");
    expect(files).not.toContain('from "lucide-react"');
  });
});

describe("privacidade financeira da Home", () => {
  afterEach(() => setFinancialValuesHidden(false));

  it("oculta qualquer valor pelo formatador canônico usado nos cards", () => {
    setFinancialValuesHidden(true);
    expect(formatPrivateBRL(1234.56)).toBe("R$ ••••");
    expect(formatBRL(-9876.54)).toBe("R$ ••••");
  });

  it("restaura a formatação pt-BR ao mostrar os valores", () => {
    setFinancialValuesHidden(false);
    expect(formatBRL(1234.56)).toContain("1.234,56");
  });
});