export function PageHeader({ title, description, actions, badge, className = '' }) {
  return (
    <div className={`flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-1 min-w-0 max-w-full ${className}`}>
      <div className="space-y-1 min-w-0 flex-1">
        <div className="flex items-center gap-2.5 flex-wrap">
          <h1 className="text-2xl lg:text-[26px] font-bold text-[#25313B] tracking-tight leading-tight">
            {title}
          </h1>
          {badge && <div>{badge}</div>}
        </div>
        {description && (
          <p className="text-sm text-[#64717B] font-normal leading-relaxed">
            {description}
          </p>
        )}
      </div>

      {actions && (
        <div className="flex items-center gap-2 flex-wrap min-w-0 max-w-full">
          {actions}
        </div>
      )}
    </div>
  );
}
