import {Link, NavLink, Route, Routes} from 'react-router-dom';
import MarimekkoPage from './pages/MarimekkoPage';
import HeatmapPage from './pages/HeatmapPage';

function Landing() {
  return (
    <div>
      <h1>Pokémon Champions VGC — Damage Visualizations</h1>
      <p className="subtitle">
        Two views of the current Regulation M-B doubles metagame, built from
        Pikalytics ranked battle data: where the damage you face comes from,
        and where the field is weakest.
      </p>
      <div className="landing-cards">
        <Link className="landing-card" to="/marimekko">
          <h2>Where does the damage come from?</h2>
          <p>
            A marimekko of expected damage output across the metagame, weighted
            by Pokémon usage and move usage, broken down by attack type and
            physical/special split. Hover any cell for its top contributors.
          </p>
        </Link>
        <Link className="landing-card" to="/heatmap">
          <h2>Where is the field weakest?</h2>
          <p>
            If you bring a generic 90 BP attack of each type, how much damage
            does it deal to the usage-weighted field? An 18×2 heatmap of
            relative damage, with the defenders that drive each cell.
          </p>
        </Link>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <div className="app-shell">
      <nav className="nav">
        <Link to="/" className="nav-title">Champions VGC Damage Viz</Link>
        <NavLink to="/marimekko">Damage sources</NavLink>
        <NavLink to="/heatmap">Field weakness</NavLink>
      </nav>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/marimekko" element={<MarimekkoPage />} />
        <Route path="/heatmap" element={<HeatmapPage />} />
      </Routes>
    </div>
  );
}
