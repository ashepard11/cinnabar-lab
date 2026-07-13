import { useState } from 'react';
import type { ReactNode } from 'react';

/**
 * Collapsible evaluation section (SPEC-team-evaluator.md Phase 8). Collapsed
 * state is component-local — the URL carries the team and condition only.
 */
export default function EvalSection({
  title, subtitle, children, defaultOpen = true,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="eval-section">
      <button className="eval-section-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="eval-caret">{open ? '▾' : '▸'}</span>
        <h2>{title}</h2>
      </button>
      {open && (
        <div className="eval-section-body">
          {subtitle && <p className="footer-note" style={{ marginTop: 0 }}>{subtitle}</p>}
          {children}
        </div>
      )}
    </section>
  );
}
