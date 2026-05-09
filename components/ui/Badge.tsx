interface BadgeProps {
  label: string;
  color?: 'default' | 'green' | 'orange' | 'blue';
}

const COLOR_STYLES: Record<NonNullable<BadgeProps['color']>, string> = {
  default: 'bg-[#f5f3f1] text-[#777169]',
  green: 'bg-green-50 text-green-700',
  orange: 'bg-orange-50 text-orange-700',
  blue: 'bg-blue-50 text-blue-700',
};

export default function Badge({ label, color = 'default' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-[9999px] px-2 py-0.5 text-xs font-medium ${COLOR_STYLES[color]}`}
    >
      {label}
    </span>
  );
}
