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
  /**
   * Metagame weights renormalized to sum to 1 across the variant set. Use this
   * anywhere a weighted mean over the field is needed (e.g. the rankings page's
   * expected win rate), so the result reads as a true probability in [0, 1].
   */
  weightsNormalized: Map<string, number>;
  byId: Map<string, VariantMeta>;
}

/**
 * Renormalize a weight map to sum to 1. The raw weights in defender-variants.json
 * are team-inclusion rates (they sum to ~5.4, one per team slot), which is fine
 * for scale-invariant rankings but wrong for a weighted average — normalize once,
 * here, so every page that needs a distribution shares the same definition.
 */
export function normalizeWeights(weights: Map<string, number>): Map<string, number> {
  let total = 0;
  for (const w of weights.values()) total += w;
  const out = new Map<string, number>();
  if (total <= 0) return out;
  for (const [id, w] of weights) out.set(id, w / total);
  return out;
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
  const weightsNormalized = useMemo(() => normalizeWeights(weights), [weights]);
  const label = useMemo(
    () => (id: string) => {
      const v = byId.get(id);
      return v ? (v.item && !v.id.includes('mega') ? `${v.species} (${v.item})` : v.species) : id;
    },
    [byId],
  );

  return { variants, error, label, weights, weightsNormalized, byId };
}
