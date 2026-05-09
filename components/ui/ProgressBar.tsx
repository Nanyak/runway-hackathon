interface ProgressBarProps {
  value: number;
  color?: string;
}

export default function ProgressBar({ value, color = '#000000' }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="h-1 w-full rounded-full bg-[#e5e5e5] overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-300"
        style={{ width: `${clamped}%`, backgroundColor: color }}
      />
    </div>
  );
}
