import { Search, ChevronDown, X } from 'lucide-react';

export function Input({
  label,
  error,
  icon: Icon,
  className = '',
  id,
  ...props
}) {
  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

  return (
    <div className={`space-y-1.5 ${className}`}>
      {label && (
        <label htmlFor={inputId} className="block text-xs font-semibold text-[#25313B]">
          {label}
        </label>
      )}
      <div className="relative">
        {Icon && (
          <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#64717B] pointer-events-none">
            <Icon size={16} />
          </div>
        )}
        <input
          id={inputId}
          className={`w-full h-10 px-3.5 ${
            Icon ? 'pl-10' : ''
          } text-sm border rounded-xl bg-white text-[#25313B] placeholder-[#64717B]/60 transition-all focus:outline-none focus:ring-2 focus:ring-[#16845B]/20 focus:border-[#16845B] ${
            error ? 'border-[#B42318]' : 'border-[#E1E6E9] hover:border-[#CBD5E1]'
          }`}
          {...props}
        />
      </div>
      {error && <p className="text-xs text-[#B42318] font-medium">{error}</p>}
    </div>
  );
}

export function Select({
  label,
  options = [],
  error,
  className = '',
  id,
  ...props
}) {
  const selectId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

  return (
    <div className={`space-y-1.5 ${className}`}>
      {label && (
        <label htmlFor={selectId} className="block text-xs font-semibold text-[#25313B]">
          {label}
        </label>
      )}
      <div className="relative">
        <select
          id={selectId}
          className={`w-full h-10 pl-3.5 pr-9 text-sm border rounded-xl bg-white text-[#25313B] transition-all appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#16845B]/20 focus:border-[#16845B] ${
            error ? 'border-[#B42318]' : 'border-[#E1E6E9] hover:border-[#CBD5E1]'
          }`}
          {...props}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={16}
          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#64717B] pointer-events-none"
        />
      </div>
      {error && <p className="text-xs text-[#B42318] font-medium">{error}</p>}
    </div>
  );
}

export function Textarea({
  label,
  error,
  className = '',
  id,
  rows = 3,
  ...props
}) {
  const textareaId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

  return (
    <div className={`space-y-1.5 ${className}`}>
      {label && (
        <label htmlFor={textareaId} className="block text-xs font-semibold text-[#25313B]">
          {label}
        </label>
      )}
      <textarea
        id={textareaId}
        rows={rows}
        className={`w-full p-3 text-sm border rounded-xl bg-white text-[#25313B] placeholder-[#64717B]/60 transition-all focus:outline-none focus:ring-2 focus:ring-[#16845B]/20 focus:border-[#16845B] resize-y ${
          error ? 'border-[#B42318]' : 'border-[#E1E6E9] hover:border-[#CBD5E1]'
        }`}
        {...props}
      />
      {error && <p className="text-xs text-[#B42318] font-medium">{error}</p>}
    </div>
  );
}

export function SearchInput({
  placeholder = 'Search...',
  value,
  onChange,
  onClear,
  className = '',
}) {
  return (
    <div className={`relative ${className}`}>
      <Search
        size={16}
        className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#64717B] pointer-events-none"
      />
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        className="w-full h-10 pl-10 pr-9 text-sm border border-[#E1E6E9] rounded-xl bg-white text-[#25313B] placeholder-[#64717B]/60 focus:outline-none focus:ring-2 focus:ring-[#16845B]/20 focus:border-[#16845B] hover:border-[#CBD5E1] transition-all"
      />
      {value && onClear && (
        <button
          onClick={onClear}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64717B] hover:text-[#25313B] p-1 cursor-pointer"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
