import { useEffect, useState } from 'react';
import { AlertCircle, Download, FolderOpen, Link2, ShieldCheck } from 'lucide-react';
import type { ProbeResult } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { useSettings, useToast } from '../state.tsx';
import { FolderPicker, Modal, ModalHeader, Spinner } from './ui.tsx';

export function NewTaskModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (count: number) => void;
}) {
  const { settings } = useSettings();
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [threads, setThreads] = useState(16);
  const [referer, setReferer] = useState('');
  const [folderRoot, setFolderRoot] = useState('');
  const [folderRel, setFolderRel] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState('');
  const [variant, setVariant] = useState(-1);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUrl('');
    setName('');
    setThreads(settings?.defaultThreads ?? 16);
    setReferer('');
    setFolderRoot(settings?.defaultRoot ?? '');
    setFolderRel(settings?.defaultSubdir ?? '');
    setProbe(null);
    setProbeError('');
    setVariant(-1);
    setCreating(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function doProbe() {
    if (!/^https?:\/\//i.test(url.trim())) {
      toast.error('请先填写 http/https 视频链接');
      return;
    }
    setProbing(true);
    setProbeError('');
    try {
      const p = await api<ProbeResult>('/api/probe', {
        method: 'POST',
        body: JSON.stringify({ url: url.trim(), referer: referer.trim() }),
      });
      setProbe(p);
      setVariant(-1);
    } catch (e) {
      setProbe(null);
      setProbeError((e as Error).message);
    } finally {
      setProbing(false);
    }
  }

  async function create() {
    if (!/^https?:\/\//i.test(url.trim())) {
      toast.error('请填写正确的视频链接');
      return;
    }
    setCreating(true);
    try {
      await api('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          url: url.trim(),
          name: name.trim() || undefined,
          root: folderRoot,
          subdir: folderRel,
          threads,
          referer: referer.trim(),
          variantIndex: variant,
        }),
      });
      onCreated(1);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <Modal open={open} onClose={onClose} width="max-w-xl">
        <ModalHeader title="新建下载" subtitle="支持 m3u8 / mp4 直链" onClose={onClose} />
        <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-5 py-4">
          <div>
            <span className="label">视频链接</span>
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  className="input pl-9"
                  placeholder="https://.../index.m3u8"
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setProbe(null);
                    setProbeError('');
                  }}
                />
              </div>
              <button className="btn-ghost shrink-0" onClick={() => void doProbe()} disabled={probing || !url.trim()}>
                {probing ? <Spinner /> : <ShieldCheck className="h-4 w-4" />}
                探测
              </button>
            </div>
            {probeError ? (
              <div className="mt-1.5 flex items-start gap-1 text-[11px] leading-relaxed text-amber-300/90">
                <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{probeError}</span>
              </div>
            ) : null}
            {probe ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-400/15 bg-emerald-400/5 px-3 py-2 text-[11px] text-emerald-200/90">
                <ShieldCheck className="h-3.5 w-3.5" />
                {probe.kind === 'hls' ? (
                  <span>
                    HLS · {probe.segments} 个分片 · {formatDuration(probe.duration)}
                    {probe.encrypted ? ' · AES-128' : ''}
                  </span>
                ) : (
                  <span>直链文件</span>
                )}
                {probe.kind === 'hls' && probe.variants.length > 1 ? (
                  <select
                    className="ml-auto rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-slate-200 outline-none"
                    value={variant}
                    onChange={(e) => setVariant(Number(e.target.value))}
                  >
                    <option value={-1}>自动（最高画质）</option>
                    {probe.variants.map((v) => (
                      <option key={v.index} value={v.index}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <span className="label">文件名称（可选）</span>
              <input
                className="input"
                placeholder="留空则自动识别"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <span className="label">下载线程（1 - 64）</span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={64}
                  className="input"
                  value={threads}
                  onChange={(e) => setThreads(Math.max(1, Math.min(64, Number(e.target.value) || 1)))}
                />
                {[8, 16, 32, 64].map((n) => (
                  <button
                    key={n}
                    className={`chip shrink-0 py-1 ${threads === n ? 'chip-active' : ''}`}
                    onClick={() => setThreads(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <span className="label">保存到</span>
            <button
              className="flex w-full items-center gap-2 rounded-xl border border-white/[0.08] bg-black/20 px-3.5 py-2.5 text-left text-xs text-slate-300 transition hover:border-emerald-400/30"
              onClick={() => setPickerOpen(true)}
            >
              <FolderOpen className="h-4 w-4 shrink-0 text-amber-300/80" />
              <span className="min-w-0 flex-1 truncate">
                {[folderRoot, folderRel].filter(Boolean).join(' / ') || '请选择目录'}
              </span>
              <span className="shrink-0 text-[11px] text-slate-500">浏览</span>
            </button>
          </div>

          <div>
            <span className="label">Referer（可选，部分资源需要防盗链头）</span>
            <input
              className="input"
              placeholder="https://example.com/"
              value={referer}
              onChange={(e) => setReferer(e.target.value)}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-white/[0.06] px-5 py-4">
          <button className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn-primary" onClick={() => void create()} disabled={creating || !url.trim()}>
            {creating ? <Spinner /> : <Download className="h-4 w-4" />}
            开始下载
          </button>
        </div>
      </Modal>

      <FolderPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        roots={settings?.env.roots ?? []}
        initialRoot={folderRoot}
        initialRel={folderRel}
        onSelect={(root, rel) => {
          setFolderRoot(root);
          setFolderRel(rel);
        }}
      />
    </>
  );
}

function formatDuration(sec: number | null): string {
  if (!sec || !Number.isFinite(sec)) return '未知时长';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m} 分 ${String(s).padStart(2, '0')} 秒`;
}