import { useEffect, useState } from 'react';
import { fetchJSON } from '../lib';
import type { EvaluatorDex } from '../../lib/evaluator/dex';

export interface DexState {
  dex: EvaluatorDex | null;
  error: string | null;
}

/** Fetch data/evaluator-dex.json once (served statically like the other data files). */
export function useDex(): DexState {
  const [dex, setDex] = useState<EvaluatorDex | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetchJSON<EvaluatorDex>('evaluator-dex.json').then(setDex).catch((e) => setError(String(e)));
  }, []);
  return { dex, error };
}
