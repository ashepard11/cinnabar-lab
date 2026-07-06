import { useEffect, useMemo, useState } from 'react';
import { fetchJSON } from '../lib';

export interface VariantMeta {
  id: string;
  species: string;
  item: string | null;
  ability: string;
  nature: string;
  sps: Record<string, number>;
  weight: number;
  moves: Array<{ name: string; usage: number }>;
}

export interface VariantsState {
  variants: VariantMeta[] | null;
  error: string | null;
  /** Display label: "Kingambit (Black Glasses)" / plain species for Megas. */
  label: (id: string) => string;
  /** Metagame weights (team-inclusion rate) keyed by variant id. */
  weights: Map<string, number>;
  byId: Map<string, VariantMeta>;
}

/**
 * Shared variant metadata for the analysis pages (matchups, Pokémon detail,
 * team builder): one fetch of defender-variants.json, one label convention,
 * one weights map.
 */
export function useVariants(): VariantsState {
  const [variants, setVariants] = useState<VariantMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJSON<{ variants: VariantMeta[] }>('defender-variants.json')
      .then((d) => setVariants(d.variants))
      .catch((e) => setError(String(e)));
  }, []);

  const byId = useMemo(() => new Map((variants ?? []).map((v) => [v.id, v])), [variants]);
  const weights = useMemo(() => new Map((variants ?? []).map((v) => [v.id, v.weight])), [variants]);
  const label = useMemo(
    () => (id: string) => {
      const v = byId.get(id);
      return v ? (v.item && !v.id.includes('mega') ? `${v.species} (${v.item})` : v.species) : id;
    },
    [byId],
  );

  return { variants, error, label, weights, byId };
}
