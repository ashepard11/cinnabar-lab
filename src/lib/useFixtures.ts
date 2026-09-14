/**
 * src/lib/useFixtures.ts — typed loaders for data/fixtures/.
 *
 * SPEC-teambuilder.md Phase 1 builds the interface against fixtures before any
 * of the pipeline exists, because how the thing feels to use determines what
 * the pipeline has to produce, and discovering that after the matrix is built
 * is expensive.
 *
 * These are deliberately a separate hook from `useVariants`, which reads the
 * real `defender-variants.json`. When the pipeline lands, each fixture swaps
 * for a real source one at a time, and keeping the two apart makes it obvious
 * which screens are still running on invented numbers.
 *
 * The numbers in every fixture are made up. Species, weights and content ids
 * are real, so layout is exercised against plausible data.
 */
import {useEffect, useState} from 'react';
import {fetchJSON} from '../lib';
import type {
  Candidate,
  ConditionDescriptor,
  CustomSetDraft,
  EnablerRecord,
  MatchupCell,
  PositioningProfile,
  TeamScore,
} from '../../lib/teambuilder/types';
import type {Variant} from '../../lib/types';

export interface FixtureState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

function useFixture<T>(name: string, extract: (raw: never) => T): FixtureState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchJSON<never>(`fixtures/${name}.json`)
      .then((raw) => live && setData(extract(raw)))
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
    // `extract` is a stable module-level arrow at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  return {data, error, loading: data === null && error === null};
}

export const useCandidates = () =>
  useFixture<Candidate[]>('candidates', (r: {candidates: Candidate[]}) => r.candidates);

export const useConditions = () =>
  useFixture<ConditionDescriptor[]>('conditions', (r: {conditions: ConditionDescriptor[]}) => r.conditions);

export const useFixtureVariants = () =>
  useFixture<Variant[]>('variants', (r: {variants: Variant[]}) => r.variants);

export const useMatchupCells = () =>
  useFixture<MatchupCell[]>('matchup-cells', (r: {cells: MatchupCell[]}) => r.cells);

export const useEnablers = () =>
  useFixture<EnablerRecord[]>('enablers', (r: {records: EnablerRecord[]}) => r.records);

export const usePositioning = () =>
  useFixture<PositioningProfile[]>('positioning', (r: {profiles: PositioningProfile[]}) => r.profiles);

export const useTeamScore = () =>
  useFixture<TeamScore>('team-score', (r: {team: TeamScore}) => r.team);

/** p(row beats column) keyed on content id — the thin projection of the matrix. */
export const useCandidateMatchups = () =>
  useFixture<Record<string, Record<string, number>>>(
    'candidate-matchups',
    (r: {matchups: Record<string, Record<string, number>>}) => r.matchups
  );

export const useCustomSetDrafts = () =>
  useFixture<CustomSetDraft[]>('custom-set-drafts', (r: {drafts: CustomSetDraft[]}) => r.drafts);
