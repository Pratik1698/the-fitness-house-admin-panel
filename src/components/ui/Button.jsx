export function Button({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  icon: Icon,
  disabled = false,
  ...props
}) {
  const variants = {
    primary:
      'bg-[#16845B] text-white hover:bg-[#12704D] active:bg-[#0E5C3F] border border-transparent shadow-xs',
    secondary:
      'bg-white text-[#25313B] border border-[#E1E6E9] hover:bg-[#F5F7F8] active:bg-[#EEF2F4] shadow-xs',
    ghost:
      'bg-transparent text-[#64717B] hover:text-[#25313B] hover:bg-[#F5F7F8] border border-transparent',
    danger:
      'bg-[#B42318] text-white hover:bg-[#9A1E14] active:bg-[#7F1D1D] border border-transparent shadow-xs',
    success:
      'bg-[#E8F5EE] text-[#16845B] hover:bg-[#d4eddf] border border-[#16845B]/20',
    warning:
      'bg-[#FFF2D8] text-[#A66A00] hover:bg-[#ffe8b8] border border-[#A66A00]/20',
  };

  const sizes = {
    sm: 'h-8 px-3 text-xs gap-1.5 rounded-lg',
    md: 'h-10 px-4 text-sm gap-2 rounded-xl',
    lg: 'h-11 px-5 text-sm gap-2.5 rounded-xl font-semibold',
  };

  return (
    <button
      className={`inline-flex items-center justify-center font-medium transition-all duration-150 cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed shrink-0 ${variants[variant] || variants.primary} ${sizes[size] || sizes.md} ${className}`}
      disabled={disabled}
      {...props}
    >
      {Icon && <Icon size={size === 'sm' ? 14 : size === 'lg' ? 18 : 16} strokeWidth={2} />}
      {children}
    </button>
  );
}
