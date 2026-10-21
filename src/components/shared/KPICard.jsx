export function KPICard({
  icon: Icon,
  label,
  value,
  subtitle,
  trend,
  variant = 'default',
  onClick,
  className = '',
}) {
  const iconVariants = {
    default: 'bg-[#F5F7F8] text-[#25313B]',
    accent: 'bg-[#E8F5EE] text-[#16845B]',
    warning: 'bg-[#FFF2D8] text-[#A66A00]',
    error: 'bg-[#FCE9E9] text-[#B42318]',
  };

  const cardBorderVariants = {
    default: 'border-[#E1E6E9] hover:border-[#64717B]/40',
    accent: 'border-[#E1E6E9] hover:border-[#16845B]/50',
    warning: 'border-[#E1E6E9] hover:border-[#A66A00]/50',
    error: 'border-[#E1E6E9] hover:border-[#B42318]/50',
  };

  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      className={`bg-white rounded-2xl border ${cardBorderVariants[variant]} p-3.5 sm:p-4 shadow-xs transition-all duration-150 flex flex-col justify-between h-full min-h-[116px] sm:min-h-[120px] ${
        onClick ? 'cursor-pointer hover:shadow-sm group select-none' : ''
      } ${className}`}
    >
      {/* Top row: Label and Icon */}
      <div className="flex items-start justify-between gap-1.5 mb-2 min-h-[32px] sm:min-h-[34px]">
        <span className="text-xs sm:text-[13px] font-semibold text-[#64717B] leading-[1.25] group-hover:text-[#25313B] transition-colors">
          {label}
        </span>
        {Icon && (
          <div className={`w-7 h-7 sm:w-7.5 sm:h-7.5 rounded-lg flex items-center justify-center shrink-0 ${iconVariants[variant]} transition-transform duration-150 ${onClick ? 'group-hover:scale-105' : ''}`}>
            <Icon size={15} strokeWidth={2.2} />
          </div>
        )}
      </div>

      {/* Main Metric Value & Supporting Text */}
      <div>
        <p className="text-2xl sm:text-[26px] font-bold text-[#25313B] tracking-tight leading-none tabular-nums truncate">
          {value}
        </p>

        {/* Subtitle / Contextual Note */}
        {(subtitle || trend) && (
          <div className="flex items-center gap-1 mt-1.5 sm:mt-2 text-[11px] sm:text-xs text-[#64717B]">
            {trend && (
              <span className={`font-semibold shrink-0 ${
                trend.startsWith('+') || trend.startsWith('↑') ? 'text-[#16845B]' : 'text-[#B42318]'
              }`}>
                {trend}
              </span>
            )}
            {subtitle && <span className="truncate">{subtitle}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

