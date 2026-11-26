import { useId, useState, type ReactNode } from 'react';

interface TooltipProps {
  /** Plain text, or rich content (technical term in <b>, then one sentence). */
  content: ReactNode;
  /** Receives the tooltip id; put it on the focusable trigger as aria-describedby. */
  children: (describedBy: string) => ReactNode;
  align?: 'start' | 'end';
  /** Open upwards (for triggers near the bottom of the screen). */
  up?: boolean;
}

/** rb-tip popover on hover and focus; Escape hides it. */
export function Tooltip({ content, children, align = 'start', up = false }: TooltipProps) {
  const id = useId();
  const [hidden, setHidden] = useState(false);
  return (
    <span
      className={`app-tipwrap ${align === 'end' ? 'app-tipwrap--end' : ''} ${up ? 'app-tipwrap--up' : ''} ${hidden ? 'is-hidden' : ''}`}
      onKeyDown={(e) => e.key === 'Escape' && setHidden(true)}
      onPointerLeave={() => setHidden(false)}
      onBlur={() => setHidden(false)}
    >
      {children(id)}
      <span className="rb-tip" role="tooltip" id={id}>
        {content}
      </span>
    </span>
  );
}
