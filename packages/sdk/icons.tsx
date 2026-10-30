// The one icon set of the interface (lucide-react): same stroke, sizes from
// the text, colour from the theme (currentColor). Modules name their icons
// (manifest `icon`, buttons…) from this list; no emoji in the interface
// (docs/MODULES.md §7.1, checked by `npm run lint`).
import type { ComponentType, SVGProps } from 'react';
import {
  Activity,
  AlarmClock,
  AudioWaveform,
  BarChart3,
  Bell,
  Bot,
  Calendar,
  CalendarDays,
  Check,
  ChefHat,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Clapperboard,
  Clock,
  Copy,
  Download,
  Dumbbell,
  FileText,
  Film,
  Folder,
  Frown,
  Heart,
  Image,
  ImagePlus,
  Camera,
  MonitorPlay,
  Smartphone,
  Disc3,
  CalendarClock,
  Gauge,
  LayoutGrid,
  List,
  Salad,
  House,
  NotebookPen,
  Keyboard,
  Laugh,
  Library,
  Lightbulb,
  ListChecks,
  ListTodo,
  Meh,
  Mic,
  Music,
  Package,
  Pause,
  Pencil,
  Play,
  Plus,
  Repeat,
  Search,
  Settings,
  ShoppingCart,
  SkipForward,
  Smile,
  SlidersHorizontal,
  Sparkles,
  SquareCheckBig,
  Star,
  Tag,
  Timer,
  Trash2,
  TriangleAlert,
  Undo2,
  Upload,
  UtensilsCrossed,
  Video,
  X,
  Annoyed,
} from 'lucide-react';

export const ICONS = {
  activity: Activity,
  alarm: AlarmClock,
  waveform: AudioWaveform,
  chart: BarChart3,
  bell: Bell,
  bot: Bot,
  calendar: Calendar,
  'calendar-days': CalendarDays,
  check: Check,
  'chef-hat': ChefHat,
  'chevron-down': ChevronDown,
  'chevron-up': ChevronUp,
  help: CircleHelp,
  clapperboard: Clapperboard,
  clock: Clock,
  copy: Copy,
  download: Download,
  dumbbell: Dumbbell,
  file: FileText,
  film: Film,
  folder: Folder,
  heart: Heart,
  image: Image,
  'image-plus': ImagePlus,
  instagram: Camera,
  smartphone: Smartphone,
  disc: Disc3,
  'calendar-clock': CalendarClock,
  gauge: Gauge,
  grid: LayoutGrid,
  list: List,
  salad: Salad,
  home: House,
  notebook: NotebookPen,
  keyboard: Keyboard,
  library: Library,
  lightbulb: Lightbulb,
  'list-checks': ListChecks,
  'list-todo': ListTodo,
  mic: Mic,
  music: Music,
  package: Package,
  pause: Pause,
  pencil: Pencil,
  play: Play,
  plus: Plus,
  repeat: Repeat,
  search: Search,
  settings: Settings,
  'shopping-cart': ShoppingCart,
  'skip-forward': SkipForward,
  sliders: SlidersHorizontal,
  sparkles: Sparkles,
  'square-check': SquareCheckBig,
  star: Star,
  tag: Tag,
  timer: Timer,
  trash: Trash2,
  warning: TriangleAlert,
  undo: Undo2,
  upload: Upload,
  utensils: UtensilsCrossed,
  video: Video,
  close: X,
  youtube: MonitorPlay,
  // The five moods of a sport session (1 = very bad … 5 = very good).
  'mood-1': Frown,
  'mood-2': Annoyed,
  'mood-3': Meh,
  'mood-4': Smile,
  'mood-5': Laugh,
} satisfies Record<string, ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>>;

export type IconName = keyof typeof ICONS;

/** Whether a manifest's `icon` names an icon of the set. */
export function isIconName(name: string): name is IconName {
  return Object.prototype.hasOwnProperty.call(ICONS, name);
}

/**
 * An icon of the set: `size` in px (default 1.15 em of the text), stroke
 * 1.75, colour of the text (or a theme token through `className`/`style`).
 * Decorative by default (aria-hidden); give `label` when it carries meaning.
 */
export function Icon(props: {
  name: IconName | string;
  size?: number | string;
  label?: string;
  className?: string;
}) {
  const Component = isIconName(props.name) ? ICONS[props.name] : ICONS.package;
  return (
    <Component
      size={props.size ?? '1.15em'}
      strokeWidth={1.75}
      className={`ui-icon${props.className ? ` ${props.className}` : ''}`}
      aria-hidden={props.label ? undefined : true}
      aria-label={props.label}
      role={props.label ? 'img' : undefined}
    />
  );
}
