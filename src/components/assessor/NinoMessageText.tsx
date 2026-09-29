import { Fragment } from "react";
import { renderNinoInline } from "@/lib/nino/messageFormat";

/** Mensagem do Nino no app: *negrito* vira <strong>, quebras de linha preservadas pelo balão. */
export function NinoMessageText({ text }: { text: string }) {
  return <>{renderNinoInline(String(text ?? "")).map((part, index) => <Fragment key={index}>{part}</Fragment>)}</>;
}
