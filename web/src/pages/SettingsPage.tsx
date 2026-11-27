import { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Cpu,
  FolderOpen,
  HardDrive,
  Loader2,
  Plus,
  Save,
  Server,
  Sparkles,
  Trash2,
  Wifi,
  XCircle,
} from 'lucide-react';
import type { SettingsResponse, SourceConfig, SourceTestResult } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { useSettings, useToast } from '../state.tsx';
import { FolderPicker, Spinner, Switch } from '../components/ui.tsx';

interface TestState {
  loading?: boolean;
  result?: SourceTestResult;
}

export function SettingsPage() {
  const { settings, save, saving } = useSettings();
  const toast = useToast();
  const [draft, setDraft] = useState<SettingsResponse | null>(null);
  const [dirty, setDirty] = useState(false);
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [addingPresets, setAddingPresets] = useState(false);

  useEffect(() => {
    if (settings) {
      setDraft(settings);
      setDirty(false);
    }
  }, [settings]);

  if (!draft) {
    return (
      <div className="flex items-center gap-2 py-20 text-sm text-slate-400">
        <Spinner /> 正在读取设置...
      </div>
    );
  }

  function patch(p: Partial<SettingsResponse>) {
    setDraft((d) => (d ? { ...d, ...p } : d));
    setDirty(true);
  }

  function updateSource(id: string, p: Partial<SourceConfig>) {
    if (!draft) return;
    patch({ sources: draft.sources.map((s) => (s.id === id ? { ...s, ...p } : s)) });
  }

  async function testSource(s: SourceConfig) {
    if (!s.url.trim()) {
      toast.error('请先填写接口地址');
      return;
    }
    setTests((t) => ({ ...t, [s.id]: { loading: true } }));
    try {
      const result = await api<SourceTestResult>('/api/sources/test', {
        method: 'POST',
        body: JSON.stringify({ url: s.url.trim(), name: s.name }),
      });
      setTests((t) => ({ ...t, [s.id]: { result } }));
    } catch (e) {
      setTests((t) => ({
        ...t,
        [s.id]: {
          result: {
            ok: false,
            name: s.name,
            sites: 0,
            usable: 0,
            multiRepo: false,
            sample: [],
            error: (e as Error).message,
          },
        },
      }));
    }
  }

  async function addPresets() {
    const d = draft;
    if (!d) return;
    setAddingPresets(true);
    try {
      const { presets } = await api<{ presets: SourceConfig[] }>('/api/presets');
      const existing = new Set(d.sources.map((s) => s.url.trim()).filter(Boolean));
      const add = presets.filter((p) => !existing.has(p.url.trim()));
      if (!add.length) {
        toast.info('推荐接口都已存在');
        return;
      }
      patch({
        sources: [
          ...d.sources,
          ...add.map((p, i) => ({ ...p, id: `${p.id}-${Date.now()}-${i}` })),
        ],
      });
      toast.success(`已添加 ${add.length} 个推荐接口，记得保存`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAddingPresets(false);
    }
  }

  async function onSave() {
    const d = draft;
    if (!d) return;
    try {
      const sources = d.sources
        .map((s) => ({ ...s, name: s.name.trim(), url: s.url.trim() }))
        .filter((s) => s.url);
      await save({
        sources,
        defaultRoot: d.defaultRoot,
        defaultSubdir: d.defaultSubdir,
        defaultThreads: d.defaultThreads,
        maxConcurrentTasks: d.maxConcurrentTasks,
        keepParts: d.keepParts,
        outputFormat: d.outputFormat,
        userAgent: d.userAgent,
      });
      setDirty(false);
      toast.success('设置已保存');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="animate-fade-up mx-auto max-w-5xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">设置</h1>
          <p className="mt-0.5 text-xs text-slate-500">接口配置、下载参数与运行环境</p>
        </div>
        <div className="flex items-center gap-3">
          {dirty ? <span className="text-[11px] text-amber-300/90">有未保存的修改</span> : null}
          <button className="btn-primary" onClick={() => void onSave()} disabled={saving || !dirty}>
            {saving ? <Spinner /> : <Save className="h-4 w-4" />}
            保存设置
          </button>
        </div>
      </div>

      <section className="panel mt-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <Server className="h-4 w-4 text-emerald-300" /> TBox 接口
            </h2>
            <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-slate-500">
              支持 TVBox 单仓 JSON（sites）、多仓（urls），也可以直接填写苹果CMS 采集接口（形如 /api.php/provide/vod）。
              保存后搜索会自动加载所有启用的站点。
            </p>
          </div>
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={() => void addPresets()} disabled={addingPresets}>
              {addingPresets ? <Spinner /> : <Sparkles className="h-4 w-4" />}
              推荐接口
            </button>
            <button
              className="btn-soft"
              onClick={() =>
                patch({
                  sources: [
                    ...draft.sources,
                    {
                      id: `src-${Date.now()}`,
                      name: `接口${draft.sources.length + 1}`,
                      url: '',
                      enabled: true,
                    },
                  ],
                })
              }
            >
              <Plus className="h-4 w-4" /> 添加接口
            </button>
          </div>
        </div>

        <div className="mt-4 space-y-2.5">
          {draft.sources.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-xs text-slate-500">
              还没有接口，点「添加接口」或「推荐接口」开始
            </div>
          ) : null}

          {draft.sources.map((s) => {
            const t = tests[s.id];
            return (
              <div key={s.id} className="rounded-xl border border-white/[0.06] bg-black/15 p-3">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                  <div className="flex items-center gap-2.5 lg:w-[180px] lg:shrink-0">
                    <Switch checked={s.enabled} onChange={(v) => updateSource(s.id, { enabled: v })} />
                    <input
                      className="input h-9 py-1.5"
                      placeholder="接口名称"
                      value={s.name}
                      onChange={(e) => updateSource(s.id, { name: e.target.value })}
                    />
                  </div>
                  <input
                    className="input h-9 min-w-0 flex-1 py-1.5 font-mono text-xs"
                    placeholder="https://example.com/tvbox.json 或 /api.php/provide/vod"
                    value={s.url}
                    onChange={(e) => updateSource(s.id, { url: e.target.value })}
                  />
                  <div className="flex shrink-0 gap-1.5">
                    <button className="btn-ghost h-9 px-3 py-1.5" onClick={() => void testSource(s)} disabled={t?.loading}>
                      {t?.loading ? <Spinner /> : <Wifi className="h-3.5 w-3.5" />}
                      测试
                    </button>
                    <button
                      className="btn-icon h-9 w-9 text-rose-300/80 hover:bg-rose-500/15 hover:text-rose-200"
                      title="删除接口"
                      onClick={() => patch({ sources: draft.sources.filter((x) => x.id !== s.id) })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {t?.result ? (
                  <div
                    className={`mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed ${
                      t.result.ok ? 'text-emerald-300/90' : 'text-rose-300/90'
                    }`}
                  >
                    {t.result.ok ? (
                      <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />
                    ) : (
                      <XCircle className="mt-0.5 h-3 w-3 shrink-0" />
                    )}
                    <span>
                      {t.result.ok
                        ? `可用 ${t.result.usable}/${t.result.sites} 个站点${t.result.sample.length ? `：${t.result.sample.join('、')}` : ''}`
                        : t.result.error || '测试失败'}
                    </span>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel mt-4 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          <Cpu className="h-4 w-4 text-emerald-300" /> 下载偏好
        </h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <span className="label">默认保存目录</span>
            <button
              className="flex w-full items-center gap-2 rounded-xl border border-white/[0.08] bg-black/20 px-3.5 py-2.5 text-left text-xs text-slate-300 transition hover:border-emerald-400/30"
              onClick={() => setPickerOpen(true)}
            >
              <FolderOpen className="h-4 w-4 shrink-0 text-amber-300/80" />
              <span className="min-w-0 flex-1 truncate">
                {[draft.defaultRoot, draft.defaultSubdir].filter(Boolean).join(' / ') || '请选择目录'}
              </span>
              <span className="shrink-0 text-[11px] text-slate-500">浏览</span>
            </button>
            <p className="field-hint">可在添加任务时临时更换目录</p>
          </div>

          <div>
            <span className="label">默认下载线程：{draft.defaultThreads}</span>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={1}
                max={64}
                value={draft.defaultThreads}
                onChange={(e) => patch({ defaultThreads: Number(e.target.value) })}
                className="w-full accent-emerald-400"
              />
              <input
                type="number"
                min={1}
                max={64}
                className="input w-20 shrink-0 text-center"
                value={draft.defaultThreads}
                onChange={(e) =>
                  patch({ defaultThreads: Math.max(1, Math.min(64, Number(e.target.value) || 1)) })
                }
              />
            </div>
            <p className="field-hint">分片并发数，过高可能触发个别 CDN 限速</p>
          </div>

          <div>
            <span className="label">同时下载任务数</span>
            <select
              className="input"
              value={draft.maxConcurrentTasks}
              onChange={(e) => patch({ maxConcurrentTasks: Number(e.target.value) })}
            >
              {[1, 2, 3, 4, 5, 6, 8].map((n) => (
                <option key={n} value={n}>
                  {n} 个任务
                </option>
              ))}
            </select>
            <p className="field-hint">每个任务内部仍使用上面的线程数</p>
          </div>

          <div>
            <span className="label">输出格式</span>
            <select
              className="input"
              value={draft.outputFormat}
              onChange={(e) => patch({ outputFormat: e.target.value === 'ts' ? 'ts' : 'mp4' })}
            >
              <option value="mp4">MP4（兼容性更好）</option>
              <option value="ts">TS（合并更快）</option>
            </select>
            <p className="field-hint">
              {draft.env.ffmpeg.ok ? '已检测到 ffmpeg，可自动转封装' : '未检测到 ffmpeg 时将直接拼接为 TS'}
            </p>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
            <div>
              <div className="text-xs font-medium text-slate-200">保留分片文件</div>
              <div className="mt-0.5 text-[11px] text-slate-500">完成后保留临时分片，便于排查</div>
            </div>
            <Switch checked={draft.keepParts} onChange={(v) => patch({ keepParts: v })} />
          </div>

          <div>
            <span className="label">默认 User-Agent</span>
            <input
              className="input font-mono text-xs"
              value={draft.userAgent}
              onChange={(e) => patch({ userAgent: e.target.value })}
            />
            <p className="field-hint">个别站点会校验 UA</p>
          </div>
        </div>
      </section>

      <section className="panel mt-4 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          <HardDrive className="h-4 w-4 text-emerald-300" /> 运行环境
        </h2>
        <div className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
          <div className="rounded-xl border border-white/[0.06] bg-black/15 px-4 py-3">
            <div className="text-[11px] text-slate-500">ffmpeg</div>
            <div className={`mt-1 flex items-center gap-1.5 ${draft.env.ffmpeg.ok ? 'text-emerald-300' : 'text-amber-300'}`}>
              {draft.env.ffmpeg.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
              {draft.env.ffmpeg.version}
            </div>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-black/15 px-4 py-3">
            <div className="text-[11px] text-slate-500">数据目录</div>
            <div className="mt-1 truncate font-mono text-[11px] text-slate-300" title={draft.env.dataDir}>
              {draft.env.dataDir}
            </div>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-black/15 px-4 py-3 sm:col-span-2">
            <div className="text-[11px] text-slate-500">下载根目录（Docker 挂载）</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {draft.env.roots.map((r) => (
                <span key={r} className="rounded-md bg-white/[0.05] px-2 py-1 font-mono text-[11px] text-slate-300">
                  {r}
                </span>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-600">
              仅能选择这些根目录下的文件夹。Docker 部署请把宿主机目录挂载到容器内；
              飞牛应用可在应用设置中授权目录，或通过 extra-roots 配置添加。
            </p>
          </div>
        </div>
      </section>

      <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-[11px] leading-relaxed text-slate-500">
        本软件仅用于个人学习与技术研究，不提供、不托管任何影视资源；所有搜索结果均来自你自行配置的第三方接口。
        请于下载后 24 小时内删除相关文件并支持正版，使用本软件产生的后果由使用者自行承担。
      </div>

      <div className="h-6" />

      <FolderPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        roots={draft.env.roots}
        initialRoot={draft.defaultRoot}
        initialRel={draft.defaultSubdir}
        onSelect={(root, rel) => {
          patch({ defaultRoot: root, defaultSubdir: rel });
        }}
      />
    </div>
  );
}