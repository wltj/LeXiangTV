import { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Copy,
  Download,
  Film,
  FolderDown,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  Zap,
} from 'lucide-react';
import type { DownloadTask, TaskStatus } from '../../../shared/types.ts';
import { api, humanBytes, humanSpeed, taskPercent, taskRemainingTime } from '../api.ts';
import { useToast } from '../state.tsx';
import { ConfirmDialog, ProgressBar, Spinner } from '../components/ui.tsx';
import { NewTaskModal } from '../components/NewTaskModal.tsx';

type Filter = 'all' | 'active' | 'completed' | 'error';

const STATUS_META: Record<TaskStatus, { label: string; color: string; dot: string }> = {
  queued: { label: '排队中', color: 'text-slate-400', dot: 'bg-slate-500' },
  downloading: { label: '下载中', color: 'text-emerald-300', dot: 'bg-emerald-400' },
  paused: { label: '已暂停', color: 'text-amber-300', dot: 'bg-amber-400' },
  merging: { label: '合并中', color: 'text-cyan-300', dot: 'bg-cyan-400' },
  completed: { label: '已完成', color: 'text-emerald-300', dot: 'bg-emerald-400' },
  error: { label: '出错', color: 'text-rose-300', dot: 'bg-rose-400' },
};

export function DownloadsPage({
  tasks,
  connected,
}: {
  tasks: DownloadTask[];
  connected: boolean;
}) {
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>('all');
  const [newOpen, setNewOpen] = useState(false);
  const [toDelete, setToDelete] = useState<DownloadTask | null>(null);
  const [deleteFile, setDeleteFile] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const sorted = useMemo(() => [...tasks].sort((a, b) => b.createdAt - a.createdAt), [tasks]);

  const counts = useMemo(
    () => ({
      all: tasks.length,
      active: tasks.filter((t) => t.status === 'downloading' || t.status === 'merging' || t.status === 'queued').length,
      completed: tasks.filter((t) => t.status === 'completed').length,
      error: tasks.filter((t) => t.status === 'error').length,
    }),
    [tasks],
  );

  const filtered = useMemo(() => {
    if (filter === 'all') return sorted;
    if (filter === 'active')
      return sorted.filter((t) => t.status === 'downloading' || t.status === 'merging' || t.status === 'queued');
    if (filter === 'completed') return sorted.filter((t) => t.status === 'completed');
    return sorted.filter((t) => t.status === 'error');
  }, [sorted, filter]);

  const totalSpeed = tasks
    .filter((t) => t.status === 'downloading')
    .reduce((sum, t) => sum + (t.speed || 0), 0);

  async function action(fn: () => Promise<unknown>, okText?: string) {
    try {
      await fn();
      if (okText) toast.success(okText);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api(`/api/tasks/${toDelete.id}?file=${deleteFile ? '1' : '0'}`, { method: 'DELETE' });
      toast.success(deleteFile ? '任务与文件已删除' : '任务记录已删除');
      setToDelete(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="animate-fade-up">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">下载任务</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {connected ? '实时进度同步中' : '实时连接中断，进度可能延迟'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn-ghost"
            onClick={() => void action(() => api('/api/tasks/bulk', { method: 'POST', body: JSON.stringify({ action: 'pause' }) }), '已暂停全部下载')}
            disabled={counts.active === 0}
          >
            <Pause className="h-4 w-4" /> 全部暂停
          </button>
          <button
            className="btn-ghost"
            onClick={() => void action(() => api('/api/tasks/bulk', { method: 'POST', body: JSON.stringify({ action: 'resume' }) }), '已继续全部任务')}
            disabled={!tasks.some((t) => t.status === 'paused' || t.status === 'error')}
          >
            <Play className="h-4 w-4" /> 全部继续
          </button>
          <button className="btn-primary" onClick={() => setNewOpen(true)}>
            <Plus className="h-4 w-4" /> 新建下载
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={<Download className="h-4 w-4" />} label="进行中" value={String(counts.active)} accent="text-emerald-300" />
        <StatCard icon={<Zap className="h-4 w-4" />} label="当前速度" value={humanSpeed(totalSpeed)} accent="text-cyan-300" />
        <StatCard icon={<CheckCircle2 className="h-4 w-4" />} label="已完成" value={String(counts.completed)} accent="text-slate-200" />
        <StatCard icon={<AlertCircle className="h-4 w-4" />} label="出错" value={String(counts.error)} accent={counts.error ? 'text-rose-300' : 'text-slate-200'} />
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {(
          [
            ['all', '全部'],
            ['active', '下载中'],
            ['completed', '已完成'],
            ['error', '出错'],
          ] as Array<[Filter, string]>
        ).map(([key, label]) => (
          <button key={key} className={`chip ${filter === key ? 'chip-active' : ''}`} onClick={() => setFilter(key)}>
            {label}
            <span className="text-[10px] opacity-60">{counts[key]}</span>
          </button>
        ))}
      </div>

      <div className="mt-3 space-y-2.5">
        {filtered.length === 0 ? (
          <div className="mt-12 flex flex-col items-center text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03]">
              <Film className="h-6 w-6 text-slate-500" />
            </div>
            <p className="mt-4 text-sm text-slate-400">
              {tasks.length === 0 ? '还没有下载任务' : '当前筛选下没有任务'}
            </p>
            {tasks.length === 0 ? (
              <button className="btn-soft mt-4" onClick={() => setNewOpen(true)}>
                <Plus className="h-4 w-4" /> 新建下载
              </button>
            ) : null}
          </div>
        ) : null}

        {filtered.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            onPause={() => void action(() => api(`/api/tasks/${task.id}/pause`, { method: 'POST', body: '{}' }))}
            onResume={() => void action(() => api(`/api/tasks/${task.id}/resume`, { method: 'POST', body: '{}' }))}
            onRetry={() =>
              void action(() => api(`/api/tasks/${task.id}/retry`, { method: 'POST', body: '{}' }), '已重新加入队列')
            }
            onRefresh={() =>
              void action(
                () => api(`/api/tasks/${task.id}/retry`, { method: 'POST', body: JSON.stringify({ fresh: true }) }),
                '已重新解析并加入队列',
              )
            }
            onDelete={() => {
              setDeleteFile(false);
              setToDelete(task);
            }}
            onCopy={async () => {
              if (!task.filePath) return;
              try {
                await copyText(task.filePath);
                toast.success('路径已复制');
              } catch {
                toast.error('复制失败，请手动复制');
              }
            }}
          />
        ))}
      </div>

      <NewTaskModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={(n) => {
          setNewOpen(false);
          toast.success(`已创建 ${n} 个下载任务`);
        }}
      />

      <ConfirmDialog
        open={!!toDelete}
        title="删除任务"
        description={toDelete ? `确定删除「${toDelete.name}」这个下载任务吗？` : undefined}
        confirmText={deleteFile ? '删除任务和文件' : '删除任务'}
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onClose={() => setToDelete(null)}
      >
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2.5 text-xs text-slate-300">
          <input
            type="checkbox"
            className="h-4 w-4 accent-rose-400"
            checked={deleteFile}
            onChange={(e) => setDeleteFile(e.target.checked)}
          />
          同时删除本地视频文件{toDelete?.status === 'completed' ? '（已合并好的成片）' : ''}
        </label>
      </ConfirmDialog>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="panel px-4 py-3">
      <div className="flex items-center gap-2 text-[11px] text-slate-500">
        <span className="text-slate-500">{icon}</span>
        {label}
      </div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${accent}`}>{value}</div>
    </div>
  );
}

function TaskRow({
  task,
  onPause,
  onResume,
  onRetry,
  onRefresh,
  onDelete,
  onCopy,
}: {
  task: DownloadTask;
  onPause: () => void;
  onResume: () => void;
  onRetry: () => void;
  onRefresh: () => void;
  onDelete: () => void;
  onCopy: () => void;
}) {
  const meta = STATUS_META[task.status] ?? STATUS_META.queued;
  const pct = taskPercent(task);
  const running = task.status === 'downloading' || task.status === 'merging';
  const eta = taskRemainingTime(task);

  return (
    <div className="panel panel-hover p-4">
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.03] ${meta.color}`}
        >
          <TaskIcon status={task.status} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-slate-100">{task.name}</span>
                <span className={`flex shrink-0 items-center gap-1 text-[10px] ${meta.color}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${meta.dot} ${running ? 'animate-pulse' : ''}`} />
                  {meta.label}
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-slate-500">
                <FolderDown className="h-3 w-3 shrink-0" />
                <span className="truncate">{task.filePath || [task.root, task.subdir].filter(Boolean).join('/')}</span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {task.status === 'queued' || task.status === 'downloading' ? (
                <button className="btn-icon" title="暂停" onClick={onPause}>
                  <Pause className="h-4 w-4" />
                </button>
              ) : null}
              {task.status === 'paused' ? (
                <button className="btn-icon" title="继续" onClick={onResume}>
                  <Play className="h-4 w-4" />
                </button>
              ) : null}
              {task.status === 'error' ? (
                <>
                  <button className="btn-icon" title="重试（沿用已下载分片）" onClick={onRetry}>
                    <RotateCcw className="h-4 w-4" />
                  </button>
                  <button className="btn-icon" title="重新解析（丢弃已下载分片，适用于链接过期）" onClick={onRefresh}>
                    <RefreshCw className="h-4 w-4" />
                  </button>
                </>
              ) : null}
              {task.status === 'completed' ? (
                <button className="btn-icon" title="复制文件路径" onClick={onCopy}>
                  <Copy className="h-4 w-4" />
                </button>
              ) : null}
              <button className="btn-icon text-rose-300/80 hover:bg-rose-500/15 hover:text-rose-200" title="删除" onClick={onDelete}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          <ProgressBar value={pct} running={running} className="mt-3" />

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
            {task.kind === 'hls' ? (
              <span>
                {task.doneSegments}/{task.totalSegments || '?'} 分片
              </span>
            ) : null}
            <span>{humanBytes(task.bytes)}{task.totalBytes && task.totalBytes > task.bytes ? ` / ${humanBytes(task.totalBytes)}` : ''}</span>
            {task.status === 'downloading' ? (
              <span className="text-emerald-300/80">{humanSpeed(task.speed)}</span>
            ) : null}
            {eta ? <span>{eta}</span> : null}
            {task.threads ? <span>{task.threads} 线程</span> : null}
            {task.error ? (
              <span className="max-w-full truncate text-rose-300/90" title={task.error}>
                {task.error}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function TaskIcon({ status }: { status: TaskStatus }) {
  if (status === 'completed') return <CheckCircle2 className="h-4 w-4" />;
  if (status === 'error') return <AlertCircle className="h-4 w-4" />;
  if (status === 'paused') return <Pause className="h-4 w-4" />;
  if (status === 'queued') return <Clock3 className="h-4 w-4" />;
  if (status === 'merging') return <Loader2 className="h-4 w-4 animate-spin" />;
  return <Download className="h-4 w-4" />;
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  }
}