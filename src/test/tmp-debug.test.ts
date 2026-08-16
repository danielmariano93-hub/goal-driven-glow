import { it } from "vitest";
import { classifyConversational } from "../../supabase/functions/_shared/agent/core/Conversational.ts";
it("d", () => {
  for (const q of ["Oi nino. O que você é exatamente?","quem te criou?","você é um robô?","quanto gastei em agosto?","onde eu gasto mais?","gastei 32 no mercado","qual meu saldo?","como está minha meta?"])
    console.log(JSON.stringify([q, classifyConversational(q)]));
});
