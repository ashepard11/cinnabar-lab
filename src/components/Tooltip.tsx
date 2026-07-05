import {useCallback, useState} from 'react';
import type {ReactNode} from 'react';

export interface TooltipState {
  x: number;
  y: number;
  content: ReactNode;
}

/** Shared floating-tooltip state driven by mouse events on chart marks. */
export function useTooltip() {
  const [tip, setTip] = useState<TooltipState | null>(null);
  const show = useCallback((e: {clientX: number; clientY: number}, content: ReactNode) => {
    setTip({x: e.clientX, y: e.clientY, content});
  }, []);
  const hide = useCallback(() => setTip(null), []);
  return {tip, show, hide};
}

export function Tooltip({tip}: {tip: TooltipState | null}) {
  if (!tip) return null;
  const pad = 14;
  const width = 280;
  const left = Math.min(tip.x + pad, window.innerWidth - width - 10);
  const top = Math.min(tip.y + pad, window.innerHeight - 200);
  return (
    <div className="tooltip" style={{left, top}}>
      {tip.content}
    </div>
  );
}
