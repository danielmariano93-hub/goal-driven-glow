import { useState } from "react";
import { UserPlus } from "lucide-react";
import { normalizeBrPhone } from "@/lib/phone";

type Props = {
  onPicked: (value: { name: string; phone_e164: string }) => void;
  label?: string;
  className?: string;
};

// Reusable Contact Picker button.
// - Uses the browser Contact Picker API when available (Chrome Android).
// - Falls back to a discreet hint on unsupported devices (iOS/Safari/desktop),
//   without ever uploading the address book. The manual entry field must
//   remain visible in the parent form.
export function ContactPickerButton({ onPicked, label = "Contatos", className }: Props) {
  const [hint, setHint] = useState<string | null>(null);
  const supported =
    typeof navigator !== "undefined" &&
    // @ts-expect-error non-standard API
    typeof navigator.contacts?.select === "function" &&
    typeof (window as unknown as { ContactsManager?: unknown }).ContactsManager !== "undefined";

  async function pick() {
    if (!supported) {
      setHint("Seu dispositivo não permite escolher da agenda. Digite o telefone abaixo.");
      return;
    }
    try {
      // @ts-expect-error non-standard API
      const list: Array<{ name?: string[]; tel?: string[] }> = await navigator.contacts.select(
        ["name", "tel"],
        { multiple: false },
      );
      const c = list?.[0];
      const rawPhone = c?.tel?.[0] ?? "";
      const name = c?.name?.[0] ?? "";
      const phone_e164 = normalizeBrPhone(rawPhone);
      if (!phone_e164) {
        setHint("Telefone inválido. Ajuste manualmente abaixo.");
        return;
      }
      onPicked({ name, phone_e164 });
      setHint(null);
    } catch {
      // user cancelled or permission denied — silent
    }
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={pick}
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium"
        aria-label="Escolher contato da agenda"
      >
        <UserPlus size={12} /> {label}
      </button>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
