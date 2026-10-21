export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className = '',
}) {
  return (
    <div className={`text-center py-12 px-4 flex flex-col items-center justify-center ${className}`}>
      {Icon && (
        <div className="w-12 h-12 rounded-2xl bg-[#F5F7F8] border border-[#E1E6E9] text-[#64717B] flex items-center justify-center mb-3.5">
          <Icon size={24} strokeWidth={1.75} />
        </div>
      )}
      <h4 className="text-base font-bold text-[#25313B] tracking-tight">
        {title}
      </h4>
      {description && (
        <p className="text-xs text-[#64717B] mt-1 max-w-sm leading-relaxed">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
