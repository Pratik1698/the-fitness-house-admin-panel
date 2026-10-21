export function Card({ children, className = '', padding = true, ...props }) {
  return (
    <div
      className={`bg-white rounded-2xl border border-[#E1E6E9] shadow-xs ${padding ? 'p-6' : ''} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className = '', action }) {
  return (
    <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 ${className}`}>
      <div className="space-y-1">{children}</div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardTitle({ children, className = '' }) {
  return (
    <h3 className={`text-base font-bold text-[#25313B] tracking-tight ${className}`}>
      {children}
    </h3>
  );
}

export function CardDescription({ children, className = '' }) {
  return (
    <p className={`text-xs text-[#64717B] font-normal leading-normal ${className}`}>
      {children}
    </p>
  );
}
