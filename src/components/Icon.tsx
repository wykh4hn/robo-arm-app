export type IconName =
  | 'check'
  | 'warning'
  | 'error'
  | 'clock'
  | 'octagon'
  | 'question'
  | 'close'
  | 'play'
  | 'pause'
  | 'stop'
  | 'dot'
  | 'chevronDown'
  | 'chevronRight'
  | 'download'
  | 'expand'
  | 'camera'
  | 'arrowRight'
  | 'usb'
  | 'circle'
  | 'info';

const PATHS: Record<IconName, string> = {
  check: 'M8 1a7 7 0 100 14A7 7 0 008 1zm-1 10L4 8l1.2-1.2L7 8.6l3.8-3.8L12 6z',
  warning: 'M8 1l7.5 13h-15zM7.2 6v4h1.6V6zm0 5v1.6h1.6V11z',
  error:
    'M8 1a7 7 0 100 14A7 7 0 008 1zm2.8 4.4L9.1 8l1.7 2.6-1.2 1.2L8 9.2l-1.6 2.6-1.2-1.2L6.9 8 5.2 5.4l1.2-1.2L8 6.8l1.6-2.6z',
  clock:
    'M8 1a7 7 0 100 14A7 7 0 008 1zm0 1.6a5.4 5.4 0 110 10.8A5.4 5.4 0 018 2.6zM7.2 4v4.6l3.4 2 .8-1.3-2.6-1.6V4z',
  octagon: 'M5 1h6l4 4v6l-4 4H5l-4-4V5zm1.5 4v6h3V5z',
  question:
    'M8 1a7 7 0 100 14A7 7 0 008 1zm-.8 10h1.6v1.6H7.2zM8 3.6c1.5 0 2.7 1 2.7 2.4 0 1.2-.8 1.7-1.5 2.1-.4.3-.4.4-.4.9H7.2c0-1 .3-1.5 1-1.9.6-.4.9-.6.9-1.1 0-.5-.5-.9-1.1-.9s-1.1.4-1.2 1H5.3c.1-1.5 1.2-2.5 2.7-2.5z',
  close:
    'M3.4 2.3L8 6.9l4.6-4.6 1.1 1.1L9.1 8l4.6 4.6-1.1 1.1L8 9.1l-4.6 4.6-1.1-1.1L6.9 8 2.3 3.4z',
  play: 'M4 2.5v11l9-5.5z',
  pause: 'M4 2.5h3v11H4zm5 0h3v11H9z',
  stop: 'M3 3h10v10H3z',
  dot: 'M8 5a3 3 0 100 6 3 3 0 000-6z',
  chevronDown: 'M3.5 5.5L8 10l4.5-4.5 1 1L8 12 2.5 6.5z',
  chevronRight: 'M5.5 3.5L10 8l-4.5 4.5 1 1L12 8 6.5 2.5z',
  download: 'M7.2 1.5h1.6v7.2l2.6-2.6 1.1 1.1L8 11.7 3.5 7.2l1.1-1.1 2.6 2.6zM2 12.5h12V14H2z',
  expand: 'M2 2h5v1.6H4.7l3 3-1.1 1.1-3-3V7H2zm12 12H9v-1.6h2.3l-3-3 1.1-1.1 3 3V9H14z',
  camera: 'M5.5 3L4.5 4.5H2v8.5h12V4.5h-2.5L10.5 3zM8 6a2.5 2.5 0 110 5 2.5 2.5 0 010-5z',
  arrowRight: 'M2 7.2h9.2L8 4l1.1-1.1L14.2 8l-5.1 5.1L8 12l3.2-3.2H2z',
  usb: 'M7.2 1h1.6v8.3l2-1.4V6h-.7V4h2.8v2h-.5v2.7L8.8 10.9v1.3a1.6 1.6 0 11-1.6 0v-.9L4.6 9.5V7.8a1.2 1.2 0 111.6 0v.9l1 .7z',
  info: 'M8 1a7 7 0 100 14A7 7 0 008 1zM7.2 7h1.6v5H7.2zm0-3h1.6v1.6H7.2z',
  circle: 'M8 1a7 7 0 100 14A7 7 0 008 1zm0 1.6a5.4 5.4 0 110 10.8A5.4 5.4 0 018 2.6z',
};

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

/** Decorative icon; always pair it with visible text. */
export function Icon({ name, size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      fillRule="evenodd"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
