import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Film, Layers, Loader2, Search, Server, Sparkles, Tv, Zap } from 'lucide-react';
import type { SearchEvent, SearchItem } from '../../../shared/types.ts';
import { useSettings, useToast } from '../state.tsx';
import { appUrl } from '../api.ts';
import { DetailModal } from '../components/DetailModal.tsx';

export function SearchPage() {
  const { settings } = useSettings();
  const toast = useToast();
  const [wd, setWd] = useState('');
  const [activeWd, setActiveWd] = useState('');
  const [items, setItems] = useState<SearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [finished, setFinished] = useState(0);
  const [failed, setFailed] = useState(0);
  const [errors, setErrors] = useState<Array<{ siteName: string; error: string }>>([]);
  const [srcFilter, setSrcFilter] = useState('all');
  const [detailItem, setDetailItem] = useState<SearchItem | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      esRef.current?.close();
    };
  }, []);

  function startSearch(keyword: string) {
    const q = keyword.trim();
    if (!q) return;
    esRef.current?.close();
    setActiveWd(q);
    setItems([]);
    setErrors([]);
    setTotal(0);
    setFinished(0);
    setFailed(0);
    setSrcFilter('all');
    setLoading(true);

    const es = new EventSource(appUrl(`/api/search/stream?wd=${encodeURIComponent(q)}`));
    esRef.current = es;
    es.onmessage = (ev) => {
      let data: SearchEvent | { type: 'fatal'; error: string };
      try {
        data = JSON.parse(ev.data) as SearchEvent | { type: 'fatal'; error: string };
      } catch {
        return;
      }
      if (data.type === 'start') {
        setTotal(data.total);
      } else if (data.type === 'results') {
        setFinished((n) => n + 1);
        if (data.items.length) {
          setItems((prev) => {
            const seen = new Set(prev.map((i) => `${i.key}|${i.vodId}`));
            return [...prev, ...data.items.filter((i) => !seen.has(`${i.key}|${i.vodId}`))];
          });
        }
      } else if (data.type === 'site-error') {
        setErrors((prev) => [...prev, { siteName: data.siteName, error: data.error }].slice(-20));
        if (!data.siteKey.startsWith('source:')) {
          setFinished((n) => n + 1);
          setFailed((n) => n + 1);
        }
      } else if (data.type === 'done' || data.type === 'fatal') {
        setLoading(false);
        if (data.type === 'fatal') {
          setErrors((prev) => [...prev, { siteName: '搜索', error: data.error }]);
          toast.error(data.error);
        }
        es.close();
        if (esRef.current === es) esRef.current = null;
      }
    };
    es.onerror = () => {
      setLoading(false);
      es.close();
      if (esRef.current === es) esRef.current = null;
    };
  }

  const sourceNames = useMemo(() => {
    const set = new Set(items.map((i) => i.sourceName));
    return [...set];
  }, [items]);

  const filtered = useMemo(
    () => (srcFilter === 'all' ? items : items.filter((i) => i.sourceName === srcFilter)),
    [items, srcFilter],
  );

  const enabledSources = settings?.sources.filter((s) => s.enabled).length ?? 0;

  return (
    <div>
      {!activeWd ? (
        <div className="animate-fade-up mx-auto flex max-w-3xl flex-col items-center pt-10 text-center sm:pt-20">
          <div className="relative">
            <div className="absolute inset-0 -z-10 blur-3xl">
              <div className="mx-auto h-32 w-32 rounded-full bg-emerald-400/25" />
            </div>
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-cyan-400 shadow-[0_18px_50px_-18px_rgba(34,211,238,0.7)]">
              <Search className="h-7 w-7 text-slate-950" />
            </div>
          </div>
          <h1 className="mt-6 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            想看的影视，<span className="bg-gradient-to-r from-emerald-300 to-cyan-300 bg-clip-text text-transparent">直接搜</span>
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-400">
            聚合 TVBox 接口搜索电影与电视剧，选中剧集一键加入下载。
            <br className="hidden sm:block" />
            m3u8 分片多线程下载，完成后自动合并为 MP4。
          </p>
          <SearchBar
            value={wd}
            onChange={setWd}
            onSubmit={() => startSearch(wd)}
            large
            inputRef={inputRef}
          />
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-[11px] text-slate-500">
            <span className="chip py-1">
              <Server className="h-3 w-3" /> 已启用 {enabledSources} 个接口
            </span>
            <span className="chip py-1">
              <Zap className="h-3 w-3" /> 最高 64 线程
            </span>
            <span className="chip py-1">
              <Film className="h-3 w-3" /> 自动合并 MP4
            </span>
          </div>

          <div className="mt-10 grid w-full gap-3 sm:grid-cols-3">
            <Feature icon={<Layers className="h-4 w-4" />} title="多源聚合" desc="单仓 / 多仓 TVBox 接口，电影电视剧一网打尽" />
            <Feature icon={<Tv className="h-4 w-4" />} title="选集下载" desc="多线路、全清晰度可选，整季批量加入下载" />
            <Feature icon={<Sparkles className="h-4 w-4" />} title="省心合并" desc="分片并发下载，暂停继续，完成后自动转 MP4" />
          </div>
        </div>
      ) : (
        <div className="animate-fade-up">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-xl font-semibold text-white">搜索结果</h1>
              <p className="mt-0.5 max-w-[60vw] truncate text-xs text-slate-500">关键词：{activeWd}</p>
            </div>
            <div className="w-full sm:max-w-xl">
              <SearchBar value={wd} onChange={setWd} onSubmit={() => startSearch(wd)} inputRef={inputRef} />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-slate-500">
            {loading ? (
              <span className="flex items-center gap-1.5 text-emerald-300">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {total === 0 ? '正在加载接口配置...' : `搜索中 ${finished}/${total} 个站点`}
              </span>
            ) : (
              <span>
                共 {items.length} 个结果 · 已完成 {finished} 个站点
                {failed > 0 ? ` · ${failed} 个失败` : ''}
              </span>
            )}
            {errors.length > 0 ? (
              <details className="relative">
                <summary className="flex cursor-pointer list-none items-center gap-1 text-amber-300/80 hover:text-amber-200">
                  <AlertCircle className="h-3 w-3" /> 查看失败详情
                </summary>
                <div className="absolute left-0 top-6 z-20 w-80 space-y-1.5 rounded-xl border border-white/10 bg-[#0b121b] p-3 shadow-2xl">
                  {errors.map((e, i) => (
                    <div key={i} className="text-[11px] leading-relaxed">
                      <span className="text-slate-300">{e.siteName}</span>
                      <span className="text-slate-500"> · {e.error}</span>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
          </div>

          {sourceNames.length > 1 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button className={`chip ${srcFilter === 'all' ? 'chip-active' : ''}`} onClick={() => setSrcFilter('all')}>
                全部来源
              </button>
              {sourceNames.map((name) => (
                <button
                  key={name}
                  className={`chip ${srcFilter === name ? 'chip-active' : ''}`}
                  onClick={() => setSrcFilter(name)}
                >
                  {name}
                </button>
              ))}
            </div>
          ) : null}

          {!loading && items.length === 0 ? (
            <div className="mt-16 flex flex-col items-center text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03]">
                <Film className="h-6 w-6 text-slate-500" />
              </div>
              <p className="mt-4 text-sm text-slate-400">
                {failed > 0 ? '所有接口都没有返回结果，可在设置里更换接口' : '没有找到相关影视，换个关键词试试'}
              </p>
              {failed > 0 ? (
                <p className="mt-1 text-xs text-slate-600">检查「设置 → TBox 接口」是否有效，或点「测试」查看可用站点数</p>
              ) : null}
            </div>
          ) : null}

          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {filtered.map((item) => (
              <PosterCard key={`${item.key}|${item.vodId}`} item={item} onOpen={() => setDetailItem(item)} />
            ))}
          </div>
        </div>
      )}

      <DetailModal
        item={detailItem}
        onClose={() => setDetailItem(null)}
        onAdded={(n) => {
          setDetailItem(null);
          toast.success(`已加入 ${n} 个下载任务`);
        }}
      />
    </div>
  );
}

function SearchBar({
  value,
  onChange,
  onSubmit,
  large,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  large?: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className={`mt-6 flex w-full gap-2 ${large ? 'max-w-2xl' : ''}`}>
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <input
          ref={inputRef}
          className={`input pl-11 ${large ? 'h-14 rounded-2xl border-white/[0.12] bg-black/30 text-base shadow-xl' : ''}`}
          placeholder="输入电影或电视剧名称，例如：流浪地球"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSubmit();
          }}
        />
      </div>
      <button className={`btn-primary shrink-0 ${large ? 'h-14 rounded-2xl px-6' : ''}`} onClick={onSubmit}>
        搜索
      </button>
    </div>
  );
}

function Feature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="panel p-4 text-left">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-400/10 text-emerald-300">{icon}</div>
      <div className="mt-2.5 text-sm font-medium text-slate-200">{title}</div>
      <div className="mt-1 text-[11px] leading-relaxed text-slate-500">{desc}</div>
    </div>
  );
}

function PosterCard({ item, onOpen }: { item: SearchItem; onOpen: () => void }) {
  const [src, setSrc] = useState(item.pic ? appUrl(`/api/img?url=${encodeURIComponent(item.pic)}`) : '');
  const [broken, setBroken] = useState(!item.pic);
  const [triedDirect, setTriedDirect] = useState(false);

  return (
    <button className="group animate-fade-up text-left" onClick={onOpen}>
      <div className="relative aspect-[2/3] overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.03] shadow-lg shadow-black/20">
        {!broken && src ? (
          <img
            src={src}
            alt={item.name}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
            onError={() => {
              if (!triedDirect && item.pic) {
                setTriedDirect(true);
                setSrc(item.pic);
              } else {
                setBroken(true);
              }
            }}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-slate-800/40 to-slate-900/60 text-slate-600">
            <Film className="h-7 w-7" />
            <span className="px-3 text-center text-[10px] leading-relaxed">暂无海报</span>
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/70 to-transparent opacity-80" />
        {item.remarks ? (
          <span className="absolute left-2 top-2 max-w-[calc(100%-16px)] truncate rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] text-white/90 backdrop-blur">
            {item.remarks}
          </span>
        ) : null}
        {item.score && item.score !== '0.0' ? (
          <span className="absolute right-2 top-2 rounded-md bg-emerald-500/25 px-1.5 py-0.5 text-[10px] font-medium text-emerald-200 backdrop-blur">
            {item.score}
          </span>
        ) : null}
      </div>
      <div className="mt-2 px-0.5">
        <div className="line-clamp-1 text-sm font-medium text-slate-100 transition group-hover:text-emerald-300">
          {item.name}
        </div>
        <div className="mt-0.5 line-clamp-1 text-[11px] text-slate-500">
          {item.siteName}
          {item.year ? ` · ${item.year}` : ''}
          {item.typeName ? ` · ${item.typeName}` : ''}
        </div>
      </div>
    </button>
  );
}