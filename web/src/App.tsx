import { useEffect, useState } from 'react';
import { Clapperboard, Download, Search, Settings, Wifi, WifiOff } from 'lucide-react';
import { SettingsProvider, ToastProvider, useSettings, useTaskStream } from './state.tsx';
import { SearchPage } from './pages/SearchPage.tsx';
import { DownloadsPage } from './pages/DownloadsPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';

type Tab = 'search' | 'downloads' | 'settings';

export default function App() {
  return (
    <ToastProvider>
      <SettingsProvider>
        <Shell />
      </SettingsProvider>
    </ToastProvider>
  );
}

function readTab(): Tab {
  const h = window.location.hash.replace(/^#\/?/, '');
  return h === 'downloads' || h === 'settings' ? h : 'search';
}

function Shell() {
  const [tab, setTab] = useState<Tab>(readTab);
  const { tasks, connected } = useTaskStream();
  const { settings } = useSettings();

  useEffect(() => {
    const onHash = () => setTab(readTab());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (t: Tab) => {
    window.location.hash = `/${t}`;
    setTab(t);
  };

  const activeCount = tasks.filter(
    (t) => t.status === 'downloading' || t.status === 'merging' || t.status === 'queued',
  ).length;

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-[220px] shrink-0 flex-col border-r border-white/[0.06] bg-black/20 px-3 py-5 lg:flex">
        <div className="flex items-center gap-3 px-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-400 shadow-[0_12px_30px_-12px_rgba(34,211,238,0.8)]">
            <Clapperboard className="h-5 w-5 text-slate-950" />
          </div>
          <div>
            <div className="text-base font-semibold tracking-wide text-white">飞影</div>
            <div className="text-[10px] tracking-wide text-slate-500">飞牛影视下载</div>
          </div>
        </div>

        <nav className="mt-8 space-y-1">
          <NavItem icon={<Search className="h-4 w-4" />} label="搜索影视" active={tab === 'search'} onClick={() => go('search')} />
          <NavItem
            icon={<Download className="h-4 w-4" />}
            label="下载任务"
            active={tab === 'downloads'}
            badge={activeCount}
            onClick={() => go('downloads')}
          />
          <NavItem icon={<Settings className="h-4 w-4" />} label="设置" active={tab === 'settings'} onClick={() => go('settings')} />
        </nav>

        <div className="mt-auto space-y-2 px-2 pb-1">
          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            {connected ? (
              <Wifi className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <WifiOff className="h-3.5 w-3.5 text-rose-400" />
            )}
            {connected ? '实时连接正常' : '与服务器断开'}
          </div>
          <div className="text-[10px] text-slate-600">
            v1.0.0 · {settings?.env.platform === 'linux' ? '飞牛 OS' : '本地模式'}
          </div>
          <div className="text-[10px] leading-relaxed text-slate-600">仅供个人学习 · 请于 24 小时内删除</div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 pb-20 lg:pb-0">
        <div className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
          <div className={tab === 'search' ? '' : 'hidden'}>
            <SearchPage />
          </div>
          <div className={tab === 'downloads' ? '' : 'hidden'}>
            <DownloadsPage tasks={tasks} connected={connected} />
          </div>
          <div className={tab === 'settings' ? '' : 'hidden'}>
            <SettingsPage />
          </div>
        </div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.07] bg-[#080d13]/95 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-md items-stretch">
          <MobileNavItem icon={<Search className="h-5 w-5" />} label="搜索" active={tab === 'search'} onClick={() => go('search')} />
          <MobileNavItem
            icon={<Download className="h-5 w-5" />}
            label="下载"
            active={tab === 'downloads'}
            badge={activeCount}
            onClick={() => go('downloads')}
          />
          <MobileNavItem icon={<Settings className="h-5 w-5" />} label="设置" active={tab === 'settings'} onClick={() => go('settings')} />
        </div>
      </nav>
    </div>
  );
}

function NavItem({
  icon,
  label,
  active,
  badge,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${
        active
          ? 'border border-emerald-400/20 bg-gradient-to-r from-emerald-400/15 to-cyan-400/5 text-emerald-200'
          : 'border border-transparent text-slate-400 hover:bg-white/[0.04] hover:text-white'
      }`}
    >
      <span className={active ? 'text-emerald-300' : 'text-slate-500'}>{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {badge && badge > 0 ? (
        <span className="rounded-full bg-emerald-400/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function MobileNavItem({
  icon,
  label,
  active,
  badge,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] transition ${
        active ? 'text-emerald-300' : 'text-slate-500'
      }`}
    >
      {icon}
      {label}
      {badge && badge > 0 ? (
        <span className="absolute right-[26%] top-1.5 h-4 min-w-4 rounded-full bg-emerald-400 px-1 text-[9px] font-semibold leading-4 text-slate-950">
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </button>
  );
}