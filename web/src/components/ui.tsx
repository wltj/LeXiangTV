import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUp, ChevronRight, Folder, FolderPlus, Loader2, X } from 'lucide-react';
import type { FolderEntry } from '../../../shared/types.ts';
import { api } from '../api.ts';

export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} />;
}

export function Modal({
  open,
  onClose,
  children,
  width = 'max-w-2xl',
  closable = true,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: string;
  closable?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closable) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, closable]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-[3px]" onClick={closable ? onClose : undefined} />
      <div
        className={`animate-fade-up relative flex max-h-[92vh] w-full ${width} flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0b121b] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]`}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function ModalHeader({
  title,
  subtitle,
  onClose,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/[0.06] px-5 py-4">
      <div className="min-w-0">
        <h3 className="text-base font-semibold text-slate-100">{title}</h3>
        {subtitle ? <p className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</p> : null}
      </div>
      <button className="btn-icon shrink-0" onClick={onClose} aria-label="关闭">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition ${
        checked
          ? 'border-emerald-400/40 bg-emerald-400/25'
          : 'border-white/10 bg-white/[0.06]'
      } disabled:opacity-40`}
    >
      <span
        className={`absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow transition-all ${
          checked ? 'left-[22px]' : 'left-0.5'
        }`}
        style={{ width: 18, height: 18 }}
      />
    </button>
  );
}

export function ProgressBar({
  value,
  running,
  className = '',
}: {
  value: number;
  running?: boolean;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07] ${className}`}>
      <div
        className={`h-full rounded-full transition-[width] duration-500 ${running ? 'progress-running' : 'bg-gradient-to-r from-emerald-400 to-cyan-400'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = '确认',
  danger = true,
  busy,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmText?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <Modal open={open} onClose={onClose} width="max-w-md">
      <div className="px-5 pb-5 pt-5">
        <h3 className="text-base font-semibold text-slate-100">{title}</h3>
        {description ? <p className="mt-2 text-sm leading-relaxed text-slate-400">{description}</p> : null}
        {children ? <div className="mt-3">{children}</div> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm} disabled={busy}>
            {busy ? <Spinner /> : null}
            {confirmText}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function FolderPicker({
  open,
  onClose,
  roots,
  initialRoot,
  initialRel,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  roots: string[];
  initialRoot: string;
  initialRel: string;
  onSelect: (root: string, rel: string) => void;
}) {
  const [root, setRoot] = useState(initialRoot || roots[0] || '');
  const [rel, setRel] = useState(initialRel || '');
  const [dirs, setDirs] = useState<FolderEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');

  useEffect(() => {
    if (!open) return;
    setRoot(initialRoot || roots[0] || '');
    setRel(initialRel || '');
    setNewName('');
    setError('');
  }, [open, initialRoot, initialRel, roots]);

  useEffect(() => {
    if (!open || !root) return;
    let alive = true;
    setLoading(true);
    setError('');
    api<{ dirs: FolderEntry[] }>(`/api/fs?root=${encodeURIComponent(root)}&path=${encodeURIComponent(rel)}`)
      .then((d) => {
        if (alive) setDirs(d.dirs ?? []);
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, root, rel]);

  const crumbs = useMemo(() => {
    const parts = rel.split('/').filter(Boolean);
    return parts.map((p, i) => ({ name: p, rel: parts.slice(0, i + 1).join('/') }));
  }, [rel]);

  async function createFolder() {
    const name = newName.trim();
    if (!name) return;
    const target = rel ? `${rel}/${name}` : name;
    try {
      await api('/api/fs/mkdir', { method: 'POST', body: JSON.stringify({ root, path: target }) });
      setNewName('');
      setRel(target);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Modal open={open} onClose={onClose} width="max-w-lg">
      <ModalHeader title="选择下载目录" subtitle={root} onClose={onClose} />
      <div className="flex min-h-0 flex-1 flex-col px-5 py-4">
        {roots.length > 1 ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {roots.map((r) => (
              <button
                key={r}
                className={`chip ${r === root ? 'chip-active' : ''}`}
                onClick={() => {
                  setRoot(r);
                  setRel('');
                }}
              >
                {r}
              </button>
            ))}
          </div>
        ) : null}

        <div className="mb-2 flex items-center gap-1 overflow-x-auto whitespace-nowrap text-xs text-slate-400">
          <button className="rounded-md px-1.5 py-1 hover:bg-white/5 hover:text-white" onClick={() => setRel('')}>
            {root}
          </button>
          {crumbs.map((c) => (
            <span key={c.rel} className="flex items-center gap-1">
              <ChevronRight className="h-3 w-3 text-slate-600" />
              <button
                className="rounded-md px-1.5 py-1 hover:bg-white/5 hover:text-white"
                onClick={() => setRel(c.rel)}
              >
                {c.name}
              </button>
            </span>
          ))}
        </div>

        <div className="min-h-[220px] flex-1 overflow-y-auto rounded-xl border border-white/[0.06] bg-black/20 p-2">
          {rel ? (
            <button
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-white/5 hover:text-white"
              onClick={() => setRel(rel.split('/').slice(0, -1).join('/'))}
            >
              <ArrowUp className="h-4 w-4" /> 返回上级
            </button>
          ) : null}
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-4 text-sm text-slate-500">
              <Spinner /> 读取中...
            </div>
          ) : null}
          {error ? <div className="px-3 py-3 text-sm text-rose-300">{error}</div> : null}
          {!loading && !error && dirs.length === 0 ? (
            <div className="px-3 py-4 text-sm text-slate-500">这里还没有子文件夹</div>
          ) : null}
          {dirs.map((d) => (
            <button
              key={d.rel}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-300 hover:bg-white/5 hover:text-white"
              onClick={() => setRel(d.rel)}
            >
              <Folder className="h-4 w-4 text-amber-300/80" />
              <span className="truncate">{d.name}</span>
            </button>
          ))}
        </div>

        <div className="mt-3 flex gap-2">
          <input
            className="input"
            placeholder="新建文件夹名称"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void createFolder();
            }}
          />
          <button className="btn-ghost shrink-0" onClick={() => void createFolder()} disabled={!newName.trim()}>
            <FolderPlus className="h-4 w-4" /> 新建
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-white/[0.06] px-5 py-4">
        <div className="min-w-0 truncate text-xs text-slate-500">
          {root}
          {rel ? `/${rel}` : ''}
        </div>
        <button
          className="btn-primary shrink-0"
          onClick={() => {
            onSelect(root, rel);
            onClose();
          }}
        >
          选择此文件夹
        </button>
      </div>
    </Modal>
  );
}