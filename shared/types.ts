export interface SourceConfig {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
}

export interface AppSettings {
  sources: SourceConfig[];
  defaultRoot: string;
  defaultSubdir: string;
  defaultThreads: number;
  maxConcurrentTasks: number;
  keepParts: boolean;
  outputFormat: 'mp4' | 'ts';
  userAgent: string;
}

export interface SiteInfo {
  key: string;
  name: string;
  api: string;
  sourceId: string;
  sourceName: string;
  searchable: boolean;
  header?: Record<string, string>;
}

export interface SearchItem {
  key: string;
  siteName: string;
  sourceName: string;
  vodId: string;
  name: string;
  pic: string;
  remarks: string;
  year: string;
  area: string;
  typeName: string;
  score: string;
  actor: string;
  director: string;
}

export interface Episode {
  name: string;
  url: string;
  index: number;
}

export interface Line {
  name: string;
  episodes: Episode[];
}

export interface VodDetail extends SearchItem {
  content: string;
  referer: string;
  lines: Line[];
}

export interface HlsVariant {
  index: number;
  bandwidth: number;
  resolution: string;
  label: string;
  url: string;
}

export interface ProbeResult {
  kind: 'hls' | 'file';
  isMaster: boolean;
  variants: HlsVariant[];
  duration: number | null;
  segments: number;
  encrypted: boolean;
}

export type TaskStatus = 'queued' | 'downloading' | 'paused' | 'merging' | 'completed' | 'error';

export interface DownloadTask {
  id: string;
  url: string;
  name: string;
  fileName: string;
  root: string;
  subdir: string;
  threads: number;
  referer: string;
  siteKey: string;
  sourceName: string;
  status: TaskStatus;
  error: string;
  kind: 'hls' | 'file';
  variantIndex: number;
  createdAt: number;
  updatedAt: number;
  totalSegments: number;
  doneSegments: number;
  bytes: number;
  totalBytes: number;
  speed: number;
  filePath: string;
  keepParts: boolean;
  outputFormat: 'mp4' | 'ts';
}

export interface EnvInfo {
  roots: string[];
  dataDir: string;
  ffmpeg: { ok: boolean; version: string };
  platform: string;
  version: string;
}

export interface SettingsResponse extends AppSettings {
  env: EnvInfo;
}

export interface FolderEntry {
  name: string;
  rel: string;
}

export interface FolderListing {
  root: string;
  rel: string;
  dirs: FolderEntry[];
}

export interface SourceTestResult {
  ok: boolean;
  name: string;
  sites: number;
  usable: number;
  multiRepo: boolean;
  sample: string[];
  error?: string;
}

export interface SearchStartEvent {
  type: 'start';
  total: number;
  sites: Array<{ key: string; name: string; sourceName: string }>;
}

export interface SearchResultsEvent {
  type: 'results';
  siteKey: string;
  siteName: string;
  sourceName: string;
  items: SearchItem[];
}

export interface SearchErrorEvent {
  type: 'site-error';
  siteKey: string;
  siteName: string;
  error: string;
}

export interface SearchDoneEvent {
  type: 'done';
  total: number;
  failed: number;
}

export type SearchEvent = SearchStartEvent | SearchResultsEvent | SearchErrorEvent | SearchDoneEvent;

export interface CreateTaskInput {
  url: string;
  name?: string;
  root?: string;
  subdir?: string;
  fileName?: string;
  threads?: number;
  referer?: string;
  siteKey?: string;
  sourceName?: string;
  variantIndex?: number;
  outputFormat?: 'mp4' | 'ts';
  keepParts?: boolean;
}