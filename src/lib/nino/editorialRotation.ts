/**
 * nino_home_editorial.v3 — rotação editorial da Home ("me mostre outra").
 *
 * Estado de INTERFACE apenas: pedir outra leitura não muda o ranking oficial,
 * não marca nada como dispensado/não útil e não dispara comunicação proativa.
 * A memória vale pela sessão do app: enquanto houver item não visto, evitamos
 * o ciclo A → B → A.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  hasEditorialAlternative,
  pickNextEditorialItem,
  type NinoHomeEditorialView,
  type NinoSpotlightItem,
  type NinoSupportingItem,
} from "@/lib/nino/homeEditorial";

/** Memória de sessão (módulo): sobrevive a remontagens, não a um reload. */
const seenPrimary = new Set<string>();
const seenSupporting = new Set<string>();

export function resetNinoEditorialRotationMemory() {
  seenPrimary.clear();
  seenSupporting.clear();
}

export type NinoEditorialRotation = {
  primary: NinoSpotlightItem | null;
  supporting: NinoSupportingItem[];
  canReplacePrimary: boolean;
  canReplaceSupporting: (index: number) => boolean;
  primaryNotice: string | null;
  supportingNotice: number | null;
  /** Retorna o substituto aplicado (ou null quando não havia alternativa). */
  replacePrimary: () => NinoSpotlightItem | null;
  replaceSupporting: (index: number) => NinoSupportingItem | null;
};

export const NINO_NO_ALTERNATIVE_PRIMARY = "Não encontrei outra orientação relevante agora.";

export function useNinoEditorialRotation(view: NinoHomeEditorialView): NinoEditorialRotation {
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const [supportingIds, setSupportingIds] = useState<Record<number, string>>({});
  const [primaryNotice, setPrimaryNotice] = useState<string | null>(null);
  const [supportingNotice, setSupportingNotice] = useState<number | null>(null);

  const signature = `${view.primary?.id ?? ""}|${view.supporting.map((item) => item.id).join(",")}`;

  // Diagnóstico novo desfaz a exploração: a Home volta à escolha oficial.
  useEffect(() => {
    setPrimaryId(null);
    setSupportingIds({});
    setPrimaryNotice(null);
    setSupportingNotice(null);
  }, [signature]);

  const primary = useMemo(() => {
    if (!primaryId) return view.primary;
    return view.primaryPool.find((item) => item.id === primaryId) ?? view.primary;
  }, [primaryId, view.primary, view.primaryPool]);

  const supporting = useMemo(
    () =>
      view.supporting.map((item, index) => {
        const overrideId = supportingIds[index];
        if (!overrideId) return item;
        return view.supportingPool.find((candidate) => candidate.id === overrideId) ?? item;
      }),
    [supportingIds, view.supporting, view.supportingPool],
  );

  useEffect(() => {
    if (primary) seenPrimary.add(primary.id);
    for (const item of supporting) seenSupporting.add(item.id);
  }, [primary, supporting]);

  const canReplacePrimary = useMemo(
    () =>
      Boolean(primary) &&
      hasEditorialAlternative({
        pool: view.primaryPool,
        current: primary,
        displayed: supporting,
        seenIds: seenPrimary,
      }),
    [primary, supporting, view.primaryPool],
  );

  const replacePrimary = useCallback(() => {
    if (!primary) return null;
    const next = pickNextEditorialItem({
      pool: view.primaryPool,
      current: primary,
      displayed: supporting,
      seenIds: seenPrimary,
    });
    if (!next) {
      setPrimaryNotice(NINO_NO_ALTERNATIVE_PRIMARY);
      return null;
    }
    seenPrimary.add(next.id);
    setPrimaryNotice(null);
    setPrimaryId(next.id);
    return next;
  }, [primary, supporting, view.primaryPool]);

  const canReplaceSupporting = useCallback(
    (index: number) => {
      const current = supporting[index] ?? null;
      if (!current) return false;
      return hasEditorialAlternative({
        pool: view.supportingPool,
        current,
        displayed: [...supporting.filter((_, i) => i !== index), ...(primary ? [primary] : [])],
        seenIds: seenSupporting,
      });
    },
    [primary, supporting, view.supportingPool],
  );

  const replaceSupporting = useCallback(
    (index: number) => {
      const current = supporting[index] ?? null;
      if (!current) return null;
      const next = pickNextEditorialItem({
        pool: view.supportingPool,
        current,
        displayed: [...supporting.filter((_, i) => i !== index), ...(primary ? [primary] : [])],
        seenIds: seenSupporting,
      });
      if (!next) {
        setSupportingNotice(index);
        return null;
      }
      seenSupporting.add(next.id);
      setSupportingNotice(null);
      setSupportingIds((prev) => ({ ...prev, [index]: next.id }));
      return next;
    },
    [primary, supporting, view.supportingPool],
  );

  return {
    primary,
    supporting,
    canReplacePrimary,
    canReplaceSupporting,
    primaryNotice,
    supportingNotice,
    replacePrimary,
    replaceSupporting,
  };
}
