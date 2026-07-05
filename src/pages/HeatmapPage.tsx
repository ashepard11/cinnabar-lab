import {useEffect, useState} from 'react';
import Heatmap from '../components/Heatmap';
import type {Viz2Data} from '../lib';
import {fetchJSON, formatDate} from '../lib';

export default function HeatmapPage() {
  const [data, setData] = useState<Viz2Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJSON<Viz2Data>('viz2-data.json').then(setData).catch((e) => setError(String(e)));
  }, []);

  if (error) return <div className="error-note">Could not load viz2-data.json — {error}</div>;
  if (!data) return <div className="loading">Loading…</div>;

  return (
    <div>
      <h1>If I bring a generic attack of each type, how hard does it hit the field?</h1>
      <p className="subtitle">
        Relative damage (vs the average cell) of a generic 90 BP single-target
        move of each type and category against the usage-weighted defender
        field. Red = the field is weak to it, blue = the field resists it.
        Rows are sorted by their stronger cell. Hover a cell for the defenders
        that drive it.
      </p>
      <Heatmap data={data} />
      <p className="footer-note">Data last refreshed: {formatDate(data.generated_at)}</p>
    </div>
  );
}
