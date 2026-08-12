interface StatusBadgeProps {
  label: string;
  tone?: "active" | "inactive" | "neutral";
}

export default function StatusBadge({ label, tone = "neutral" }: StatusBadgeProps) {
  return <span className={`status-badge status-badge-${tone}`}>{label}</span>;
}
