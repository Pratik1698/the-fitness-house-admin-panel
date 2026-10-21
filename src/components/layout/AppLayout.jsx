import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { TopNav } from './TopNav';

export function AppLayout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#F5F7F8]">
      {/* Sidebar - fixed on desktop, slide-in drawer on mobile */}
      <Sidebar isOpen={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />

      {/* Main Content Area - offset by sidebar width on desktop */}
      <div className="lg:pl-64 flex flex-col min-h-screen">
        <TopNav onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />
        <main className="flex-1 p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
