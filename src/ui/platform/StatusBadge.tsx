interface StatusBadgeProps {
  label: string;
  status: string;
}

export default function StatusBadge({ label, status }: StatusBadgeProps) {
  return <span className={`platform-status platform-status-${status}`} data-status={status}>{label}</span>;
}
