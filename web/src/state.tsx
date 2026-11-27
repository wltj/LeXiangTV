import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { AppSettings, DownloadTask, SettingsResponse } from '../../shared/types.ts';
import { api, appUrl } from './api.ts';

interface SettingsContextValue {
  settings: SettingsResponse | null;
  saving: boolean;
  reload: () => Promise<void>;
  save: (patch: Partial<AppSettings>) => Promise<AppSettings>;
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: null,
  saving: false,
  reload: async () => undefined,
  save: async () => ({}) as AppSettings,
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    try {
      const data = await api<SettingsResponse>('/api/settings');
      setSettings(data);
    } catch (err) {
      console.error('加载设置失败', err);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(async (patch: Partial<AppSettings>) => {
    setSaving(true);
    try {
      const next = await api<AppSettings>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(patch),
      });
      setSettings((prev) => (prev ? { ...prev, ...next } : prev));
      return next;
    } finally {
      setSaving(false);
    }
  }, []);

  const value = useMemo(
    () => ({ settings, reload, save, saving }),
    [settings, reload, save, saving],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext);
}

type ToastKind = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  text: string;
  kind: ToastKind;
}

interface ToastContextValue {
  success: (text: string) => void;
  error: (text: string) => void;
  info: (text: string) => void;
}

const ToastContext = createContext<ToastContextValue>({
  success: () => undefined,
  error: () => undefined,
  info: () => undefined,
});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const push = useCallback((text: string, kind: ToastKind) => {
    const id = ++seq.current;
    setItems((prev) => [...prev, { id, text, kind }].slice(-4));
    window.setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const value = useMemo(
    () => ({
      success: (text: string) => push(text, 'success'),
      error: (text: string) => push(text, 'error'),
      info: (text: string) => push(text, 'info'),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-[min(92vw,380px)] flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={`animate-fade-up pointer-events-auto flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm shadow-2xl backdrop-blur-md ${
              t.kind === 'success'
                ? 'border-emerald-400/25 bg-emerald-950/80 text-emerald-200'
                : t.kind === 'error'
                  ? 'border-rose-400/25 bg-rose-950/80 text-rose-200'
                  : 'border-white/10 bg-slate-900/90 text-slate-200'
            }`}
          >
            <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
            <span className="leading-relaxed">{t.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}

export function useTaskStream(): { tasks: DownloadTask[]; connected: boolean } {
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let alive = true;
    api<{ tasks: DownloadTask[] }>('/api/tasks')
      .then((d) => {
        if (alive) setTasks(d.tasks ?? []);
      })
      .catch(() => undefined);

    const es = new EventSource(appUrl('/api/events'));
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as { tasks?: DownloadTask[] };
        if (Array.isArray(data.tasks)) setTasks(data.tasks);
      } catch {
        // 忽略坏消息
      }
    };
    return () => {
      alive = false;
      es.close();
    };
  }, []);

  return { tasks, connected };
}