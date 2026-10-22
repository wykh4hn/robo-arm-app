import { useEffect, useId, useState, type ReactNode } from 'react';
import styles from './Tooltip.module.css';

interface TooltipProps {
  text: string;
  /** Receives the tooltip id; put it on the focusable element as aria-describedby. */
  children: (describedBy: string) => ReactNode;
  align?: 'start' | 'end';
}

/** Short hint shown on hover and keyboard focus. Escape hides it. */
export function Tooltip({ text, children, align = 'start' }: TooltipProps) {
  const id = useId();
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!hidden) return;
    const reset = () => setHidden(false);
    window.addEventListener('pointermove', reset, { once: true });
    return () => window.removeEventListener('pointermove', reset);
  }, [hidden]);
  return (
    <span
      className={styles.wrap}
      onKeyDown={(e) => e.key === 'Escape' && setHidden(true)}
      onBlur={() => setHidden(false)}
    >
      {children(id)}
      <span
        role="tooltip"
        id={id}
        className={`${styles.tip} ${align === 'end' ? styles.alignEnd : ''}`}
        style={hidden ? { display: 'none' } : undefined}
      >
        {text}
      </span>
    </span>
  );
}
