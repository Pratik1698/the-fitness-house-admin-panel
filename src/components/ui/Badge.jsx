export function Badge({ children, variant = 'default', className = '', dot = false }) {
  const variants = {
    default: 'bg-[#F5F7F8] text-[#64717B] border-[#E1E6E9]',
    success: 'bg-[#E8F5EE] text-[#16845B] border-[#16845B]/20',
    warning: 'bg-[#FFF2D8] text-[#A66A00] border-[#A66A00]/20',
    error: 'bg-[#FCE9E9] text-[#B42318] border-[#B42318]/20',
    accent: 'bg-[#16845B] text-white border-transparent',
  };

  const dotColors = {
    default: 'bg-[#64717B]',
    success: 'bg-[#16845B]',
    warning: 'bg-[#A66A00]',
    error: 'bg-[#B42318]',
    accent: 'bg-white',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
        variants[variant] || variants.default
      } ${className}`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dotColors[variant] || dotColors.default}`} />}
      {children}
    </span>
  );
}

export function StatusBadge({ status, showDot = true }) {
  const map = {
    active: { label: 'Active', variant: 'success' },
    expired: { label: 'Expired', variant: 'error' },
    expiring: { label: 'Expiring Soon', variant: 'warning' },
    completed: { label: 'Completed', variant: 'success' },
    pending: { label: 'Pending', variant: 'warning' },
    overdue: { label: 'Overdue', variant: 'error' },
    partial: { label: 'Partial', variant: 'warning' },
    scheduled: { label: 'Scheduled', variant: 'default' },
    sent: { label: 'Sent', variant: 'success' },
    failed: { label: 'Failed', variant: 'error' },
    cancelled: { label: 'Cancelled', variant: 'error' },
    'no-show': { label: 'No Show', variant: 'error' },
    valid: { label: 'Valid', variant: 'success' },
  };

  const { label, variant } = map[status] || { label: status, variant: 'default' };
  return (
    <Badge variant={variant} dot={showDot}>
      {label}
    </Badge>
  );
}
