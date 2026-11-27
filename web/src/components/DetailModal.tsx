import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, Download, FolderOpen, Layers, RefreshCw, ShieldCheck, X } from 'lucide-react';
import type { ProbeResult, SearchItem, VodDetail } from '../../../shared/types.ts';
import { api, appUrl, humanBytes, sanitizeFileName } from '../api.ts';
import { useSettings, useToast } from '../state.tsx';
import { FolderPicker, Modal, ModalHeader, ProgressBar, Spinner } from './ui.tsx';

interface ProbeWithReferer extends ProbeResult {
  referer?: string;
}

export function DetailModal({
  item,
  onClose,
  onAdded,
}: {
  item: SearchItem | null;
  onClose: () => void;
  onAdded: (count: number) => void;
}) {
  const { settings } = useSettings();
  const toast = useToast();
  const [detail, setDetail] = useState<VodDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lineIdx, setLineIdx] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [probe, setProbe] = useState<ProbeWithReferer | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState('');
  const [variant, setVariant] = useState(-1);
  const [threads, setThreads] = useState(16);
  const [folderRoot, setFolderRoot] = useState('');
  const [folderRel, setFolderRel] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!item) return;
    let alive = true;
    setLoading(true);
    setDetail(null);
    setError('');
    setProbe(null);
    setProbeError('');
    setVariant(-1);
    setThreads(settings?.defaultThreads ?? 16);
    setFolderRoot(settings?.defaultRoot ?? '');
    setFolderRel(settings?.defaultSubdir ?? '');
    api<VodDetail>(`/api/detail?site=${encodeURIComponent(item.key)}&id=${encodeURIComponent(item.vodId)}`)
      .then((d) => {
        if (!alive) return;
        setDetail(d);
        const idx = pickLine(d);
        setLineIdx(idx);
        setSelected(new Set((d.lines[idx]?.episodes ?? []).map((e) => e.index)));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);

  useEffect(() => {
    const line = detail?.lines[lineIdx];
    if (!line) return;
    setSelected(new Set(line.episodes.map((e) => e.index)));
    setProbe(null);
    setProbeError('');
    setVariant(-1);
    const first = line.episodes[0];
    if (!first || !/^https?:\/\//i.test(first.url)) {
      setProbeError('该线路没有可下载的 http 地址，请换一条线路');
      return;
    }
    let alive = true;
    setProbing(true);
    api<ProbeWithReferer>('/api/probe', {
      method: 'POST',
      body: JSON.stringify({
        url: first.url,
        siteKey: detail?.key,
        referer: detail?.referer,
      }),
    })
      .then((p) => {
        if (!alive) return;
        setProbe(p);
        if (p.variants.length > 1) setVariant(-1);
      })
      .catch((e: Error) => {
        if (alive) setProbeError(e.message);
      })
      .finally(() => {
        if (alive) setProbing(false);
      });
    return () => {
      alive = false;
    };
  }, [detail, lineIdx]);

  const line = detail?.lines[lineIdx];
  const episodes = line?.episodes ?? [];
  const selectedCount = episodes.filter((e) => selected.has(e.index)).length;

  const lineLabels = useMemo(() => {
    const lines = detail?.lines ?? [];
    const counts = new Map<string, number>();
    for (const l of lines) counts.set(l.name, (counts.get(l.name) ?? 0) + 1);
    const seen = new Map<string, number>();
    return lines.map((l) => {
      if ((counts.get(l.name) ?? 0) <= 1) return l.name;
      const n = (seen.get(l.name) ?? 0) + 1;
      seen.set(l.name, n);
      return `${l.name} #${n}`;
    });
  }, [detail]);

  const targetPreview = useMemo(() => {
    if (!detail) return '';
    return [folderRoot, folderRel, sanitizeFileName(detail.name)].filter(Boolean).join(' / ');
  }, [detail, folderRoot, folderRel]);

  function toggleEpisode(index: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function addToDownloads() {
    if (!detail || !line) return;
    const eps = episodes.filter((e) => selected.has(e.index));
    if (!eps.length) {
      toast.error('请先选择要下载的剧集');
      return;
    }
    setAdding(true);
    try {
      const subdir = [folderRel, sanitizeFileName(detail.name)].filter(Boolean).join('/');
      const items = eps.map((ep) => ({
        url: ep.url,
        name: ep.name,
        fileName: eps.length === 1 ? detail.name : ep.name,
        root: folderRoot,
        subdir,
        threads,
        referer: detail.referer,
        siteKey: detail.key,
        sourceName: detail.sourceName,
        variantIndex: variant,
        outputFormat: settings?.outputFormat ?? 'mp4',
      }));
      await api('/api/tasks', { method: 'POST', body: JSON.stringify({ items }) });
      onAdded(items.length);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAdding(false);
    }
  }

  return (
    <>
      <Modal open={!!item} onClose={onClose} width="max-w-4xl">
        <ModalHeader
          title={item?.name ?? '影片详情'}
          subtitle={item ? `${item.siteName} · ${item.sourceName}` : undefined}
          onClose={onClose}
        />
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-20 text-sm text-slate-400">
              <Spinner className="h-5 w-5" /> 正在获取剧集列表...
            </div>
          ) : null}

          {error ? (
            <div className="flex items-start gap-2 rounded-xl border border-rose-400/20 bg-rose-500/5 px-4 py-3 text-sm text-rose-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>{error}</div>
            </div>
          ) : null}

          {detail ? (
            <>
              <div className="flex gap-4">
                <div className="relative hidden h-[150px] w-[100px] shrink-0 overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] sm:block">
                  {detail.pic ? (
                    <img
                      src={appUrl(`/api/img?url=${encodeURIComponent(detail.pic)}&ref=${encodeURIComponent(detail.referer)}`)}
                      alt={detail.name}
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-semibold text-white">{detail.name}</h2>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                    {detail.year ? <span className="chip py-1">{detail.year}</span> : null}
                    {detail.area ? <span className="chip py-1">{detail.area}</span> : null}
                    {detail.typeName ? <span className="chip py-1">{detail.typeName}</span> : null}
                    {detail.score && detail.score !== '0.0' ? (
                      <span className="chip chip-active py-1">评分 {detail.score}</span>
                    ) : null}
                    {detail.remarks ? <span className="chip py-1">{detail.remarks}</span> : null}
                  </div>
                  {detail.content ? (
                    <p className="mt-2.5 line-clamp-4 text-xs leading-relaxed text-slate-400">{detail.content}</p>
                  ) : null}
                </div>
              </div>

              <div className="mt-5">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-400">
                  <Layers className="h-3.5 w-3.5" /> 播放线路
                </div>
                <div className="flex flex-wrap gap-2">
                  {detail.lines.map((l, i) => (
                    <button
                      key={`${l.name}-${i}`}
                      className={`chip ${i === lineIdx ? 'chip-active' : ''}`}
                      onClick={() => setLineIdx(i)}
                    >
                      {lineLabels[i] ?? l.name}
                      <span className="text-[10px] opacity-60">{l.episodes.length}</span>
                    </button>
                  ))}
                </div>
              </div>

              {line ? (
                <>
                  <div className="mt-4 grid gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 sm:grid-cols-2">
                    <div>
                      <span className="label">清晰度</span>
                      {probing ? (
                        <div className="flex items-center gap-2 py-2 text-xs text-slate-400">
                          <Spinner /> 正在探测...
                        </div>
                      ) : probe?.kind === 'hls' && probe.variants.length > 1 ? (
                        <select
                          className="input"
                          value={variant}
                          onChange={(e) => setVariant(Number(e.target.value))}
                        >
                          <option value={-1}>自动（最高画质）</option>
                          {probe.variants.map((v) => (
                            <option key={v.index} value={v.index}>
                              {v.label}
                              {v.resolution ? ` · ${v.resolution.replace('x', '×')}` : ''}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="flex h-[42px] items-center gap-2 text-xs text-slate-400">
                          {probe ? (
                            <>
                              <ShieldCheck className="h-4 w-4 text-emerald-400" />
                              {probe.kind === 'hls' ? (
                                <span>
                                  HLS · {probe.segments} 个分片 · {formatDuration(probe.duration)}
                                  {probe.encrypted ? ' · AES-128' : ''}
                                </span>
                              ) : (
                                <span>直链文件下载</span>
                              )}
                            </>
                          ) : (
                            <span>自动识别</span>
                          )}
                        </div>
                      )}
                      {probeError ? (
                        <div className="mt-1 flex items-start gap-1 text-[11px] leading-relaxed text-amber-300/90">
                          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                          <span>{probeError}（仍可尝试加入下载）</span>
                        </div>
                      ) : null}
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

                  <div className="mt-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-xs font-medium text-slate-400">
                        剧集 <span className="text-slate-500">（已选 {selectedCount}/{episodes.length}）</span>
                      </div>
                      <div className="flex gap-2 text-xs">
                        <button
                          className="text-emerald-300 hover:text-emerald-200"
                          onClick={() => setSelected(new Set(episodes.map((e) => e.index)))}
                        >
                          全选
                        </button>
                        <span className="text-slate-700">|</span>
                        <button
                          className="text-slate-400 hover:text-white"
                          onClick={() => setSelected(new Set())}
                        >
                          全不选
                        </button>
                        <span className="text-slate-700">|</span>
                        <button
                          className="text-slate-400 hover:text-white"
                          onClick={() =>
                            setSelected((prev) => {
                              const next = new Set<number>();
                              episodes.forEach((e) => {
                                if (!prev.has(e.index)) next.add(e.index);
                              });
                              return next;
                            })
                          }
                        >
                          反选
                        </button>
                      </div>
                    </div>
                    <div className="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4 md:grid-cols-6">
                      {episodes.map((ep) => {
                        const active = selected.has(ep.index);
                        return (
                          <button
                            key={ep.index}
                            onClick={() => toggleEpisode(ep.index)}
                            className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-left text-[11px] transition ${
                              active
                                ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200'
                                : 'border-white/[0.07] bg-white/[0.02] text-slate-400 hover:border-white/20 hover:text-white'
                            }`}
                          >
                            {active ? <Check className="h-3 w-3 shrink-0" /> : null}
                            <span className="truncate">{ep.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="mt-4">
                    <span className="label">保存到</span>
                    <button
                      className="flex w-full items-center gap-2 rounded-xl border border-white/[0.08] bg-black/20 px-3.5 py-2.5 text-left text-xs text-slate-300 transition hover:border-emerald-400/30"
                      onClick={() => setPickerOpen(true)}
                    >
                      <FolderOpen className="h-4 w-4 shrink-0 text-amber-300/80" />
                      <span className="min-w-0 flex-1 truncate">{targetPreview || '请选择目录'}</span>
                      <span className="shrink-0 text-[11px] text-slate-500">浏览</span>
                    </button>
                  </div>
                </>
              ) : (
                <div className="mt-6 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-6 text-center text-sm text-slate-500">
                  该资源没有可用的下载线路
                </div>
              )}
            </>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-white/[0.06] px-5 py-4">
          <div className="min-w-0 truncate text-xs text-slate-500">
            {detail && selectedCount > 0 ? `将创建 ${selectedCount} 个下载任务` : ''}
          </div>
          <div className="flex shrink-0 gap-2">
            <button className="btn-ghost" onClick={onClose}>
              关闭
            </button>
            <button
              className="btn-primary"
              onClick={() => void addToDownloads()}
              disabled={!detail || !line || selectedCount === 0 || adding}
            >
              {adding ? <Spinner /> : <Download className="h-4 w-4" />}
              加入下载
            </button>
          </div>
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

function pickLine(detail: VodDetail): number {
  const idx = detail.lines.findIndex((l) => l.episodes.some((e) => /\.m3u8(\?|$)/i.test(e.url)));
  return idx >= 0 ? idx : 0;
}

function formatDuration(sec: number | null): string {
  if (!sec || !Number.isFinite(sec)) return '未知时长';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m} 分 ${String(s).padStart(2, '0')} 秒`;
}