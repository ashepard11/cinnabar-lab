import {useEffect, useState} from 'react';
import Marimekko from '../components/Marimekko';
import type {Viz1Data} from '../lib';
import {fetchJSON, formatDate} from '../lib';

export default function MarimekkoPage() {
  const [data, setData] = useState<Viz1Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJSON<Viz1Data>('/viz1-data.json').then(setData).catch((e) => setError(String(e)));
  }, []);

  if (error) return <div className="error-note">Could not load viz1-data.json — {error}</div>;
  if (!data) return <div className="loading">Loading…</div>;

  return (
    <div>
      <h1>Where does the damage I take come from?</h1>
      <p className="subtitle">
        Expected damage projected against your side per turn, weighted by
        Pokémon usage × move usage × average damage into a standard 100/80/80
        target (spread moves ×1.5). Column width = the type's share of all
        expected damage; within each column, the darker block is physical and
        the lighter block is special. Hover a block for its top contributors.
      </p>
      <Marimekko data={data} />
      <p className="footer-note">Data last refreshed: {formatDate(data.generated_at)}</p>
    </div>
  );
}
