import { useState } from 'react';

export function Tabs({ tabs, defaultTab, className = '' }) {
  const [active, setActive] = useState(defaultTab || tabs[0]?.id);
  const activeTab = tabs.find(t => t.id === active);

  return (
    <div className={`min-w-0 max-w-full ${className}`}>
      <div className="flex items-center gap-1 border-b border-[#E1E6E9] mb-4 overflow-x-auto min-w-0 max-w-full scrollbar-thin">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActive(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors relative cursor-pointer shrink-0 whitespace-nowrap ${
              active === tab.id
                ? 'text-[#16845B]'
                : 'text-[#64717B] hover:text-[#25313B]'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                active === tab.id ? 'bg-[#E8F5EE] text-[#16845B]' : 'bg-[#F5F7F8] text-[#64717B]'
              }`}>
                {tab.count}
              </span>
            )}
            {active === tab.id && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#16845B] rounded-full" />
            )}
          </button>
        ))}
      </div>
      <div>{activeTab?.content}</div>
    </div>
  );
}
