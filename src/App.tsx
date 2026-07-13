import {Link, NavLink, Route, Routes} from 'react-router-dom';
import MarimekkoPage from './pages/MarimekkoPage';
import HeatmapPage from './pages/HeatmapPage';
import MatchupsPage from './pages/MatchupsPage';
import MatchupDetailPage from './pages/MatchupDetailPage';
import RankingsPage from './pages/RankingsPage';
import PokemonDetailPage from './pages/PokemonDetailPage';
import TeamBuilderPage from './pages/TeamBuilderPage';
import TeamEvaluatorPage from './pages/TeamEvaluatorPage';

function Landing() {
  return (
    <div>
      <h1>Pokémon Champions VGC — Metagame Analytics</h1>
      <p className="subtitle">
        Views of the current Regulation M-B doubles metagame, built from
        Pikalytics ranked battle data: where the damage you face comes from,
        where the field is weakest, and who beats whom in a 1v1 endgame.
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
        <Link className="landing-card" to="/matchups">
          <h2>Who wins the 1v1?</h2>
          <p>
            A simulated matchup matrix over the whole metagame: P(A beats B) in
            a 1v1 Champions endgame, from seeded Pokémon Showdown battles with
            a game-theoretic move policy, across 10 starting conditions.
          </p>
        </Link>
        <Link className="landing-card" to="/rankings">
          <h2>Who's most dangerous?</h2>
          <p>
            Every variant ranked by its metagame-weighted win rate — the average
            chance it beats a random opponent drawn from the field — under any of
            the 10 starting conditions. Switch to Trick Room to see who rises.
          </p>
        </Link>
        <Link className="landing-card" to="/team-builder">
          <h2>What covers my core?</h2>
          <p>
            Pick up to four Pokémon as a team core and get partners ranked by
            how well they patch the core's worst 1v1 matchups, weighted by how
            common each opponent is.
          </p>
        </Link>
        <Link className="landing-card" to="/team-evaluator">
          <h2>How does my team hold up?</h2>
          <p>
            Paste a full team and get a multi-angle evaluation: worst matchups,
            type coverage both ways, where its damage comes from, board control
            options, RNG exposure, and effective stat totals.
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
        <Link to="/" className="nav-title">Champions VGC Analytics</Link>
        <NavLink to="/marimekko">Damage sources</NavLink>
        <NavLink to="/heatmap">Field weakness</NavLink>
        <NavLink to="/matchups">Matchups</NavLink>
        <NavLink to="/rankings">Rankings</NavLink>
        <NavLink to="/pokemon">Pokémon</NavLink>
        <NavLink to="/team-builder">Team builder</NavLink>
        <NavLink to="/team-evaluator">Team evaluator</NavLink>
      </nav>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/marimekko" element={<MarimekkoPage />} />
        <Route path="/heatmap" element={<HeatmapPage />} />
        <Route path="/matchups" element={<MatchupsPage />} />
        <Route path="/matchup/:A/:B" element={<MatchupDetailPage />} />
        <Route path="/rankings" element={<RankingsPage />} />
        <Route path="/pokemon" element={<PokemonDetailPage />} />
        <Route path="/pokemon/:variantId" element={<PokemonDetailPage />} />
        <Route path="/team-builder" element={<TeamBuilderPage />} />
        <Route path="/team-evaluator" element={<TeamEvaluatorPage />} />
      </Routes>
    </div>
  );
}
