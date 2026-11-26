import {
  Bot,
  Camera,
  CameraOff,
  Check,
  ChevronRight,
  Circle,
  CircleCheck,
  CircleHelp,
  CircleMinus,
  CircleX,
  Clock,
  Crosshair,
  Download,
  Hand,
  Info,
  ListChecks,
  LoaderCircle,
  Maximize2,
  OctagonAlert,
  Play,
  RotateCcw,
  Send,
  TriangleAlert,
  Unplug,
  Wifi,
  WifiOff,
  X,
  type LucideIcon,
} from 'lucide-react';

// Fixed meanings from design-system/README.md (Iconography).
const ICONS = {
  stop: CircleMinus,
  ok: CircleCheck,
  check: Check,
  warn: TriangleAlert,
  critical: CircleX,
  estop: OctagonAlert,
  waiting: Hand,
  running: LoaderCircle,
  pending: Circle,
  wifi: Wifi,
  wifiOff: WifiOff,
  unplug: Unplug,
  robot: Bot,
  task: ListChecks,
  tracking: Crosshair,
  clock: Clock,
  send: Send,
  play: Play,
  download: Download,
  reset: RotateCcw,
  swap: Maximize2,
  help: CircleHelp,
  info: Info,
  close: X,
  camera: Camera,
  cameraOff: CameraOff,
  chevron: ChevronRight,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

interface IconProps {
  name: IconName;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  label?: string;
}

/** Lucide icon with the design-system sizes. Decorative unless `label` is given. */
export function Icon({ name, size = 'md', className = '', label }: IconProps) {
  const C = ICONS[name];
  const cls = `rb-ic ${size === 'sm' ? 'rb-ic--sm' : size === 'lg' ? 'rb-ic--lg' : ''} ${className}`;
  return label ? (
    <C className={cls} aria-label={label} role="img" />
  ) : (
    <C className={cls} aria-hidden="true" focusable="false" />
  );
}
