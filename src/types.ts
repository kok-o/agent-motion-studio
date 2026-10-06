export type Asset = { type: 'image' | 'audio' | 'video'; path: string; sha256?: string; name?: string };
export type Caption = { startMs: number; endMs: number; text: string };
export type Scene = {
  id: string; type: 'kinetic_title' | 'product_zoom' | 'cta' | 'video'; durationFrames: number;
  trimStartSeconds?: number;
  text?: string; highlight?: string; label?: string; asset?: string; caption?: string;
  fit?: 'contain' | 'cover'; focalPoint?: { x: number; y: number };
  fontSize?: number; narration?: { asset?: string; text?: string }; captions?: Caption[];
};
export type Manifest = {
  schemaVersion: 1 | 2; id: string; seed: number;
  revision?: string; history?: Revision[];
  operationReceipts?: OperationReceipt[];
  video: { aspectRatio: '9:16' | '16:9'; fps: 30; safeArea?: number; style?: 'studio' | 'kinetic' };
  brand: { theme: 'dark' | 'light'; background: string; foreground: string; accent: string; font: 'builtin-sans' };
  assets: Record<string, Asset>;
  audio: {
    narration: { provider: 'none' | 'file' | 'edge'; gainDb?: number; voice?: string; rate?: string; pitch?: string };
    music: { provider: 'none' | 'file' | 'procedural'; asset?: string; gainDb?: number };
  };
  scenes: Scene[];
};
export type OperationReceipt = { operationId: string; requestHash: string; revisionId: string };
export type Revision = { id: string; label: string; createdAt: string; scenes: Scene[]; video: Manifest['video']; audio: Manifest['audio']; brand: Manifest['brand'] };
export type ResolvedAsset = Asset & { absolutePath: string; hash: string; bytes: number; width?: number; height?: number; durationSeconds?: number; sourceFps?: number; rotation?: number };
export type TextLayout = { lines: string[]; fontSize: number; lineHeight: number; x: number; y: number; width: number; height: number; align: 'left' | 'center' };
export type ResolvedScene = Scene & { startFrame: number; endFrame: number; layout?: TextLayout; captionLayout?: TextLayout; labelLayout?: TextLayout; resolvedCaptions?: { startFrame: number; endFrame: number; text: string }[] };
export type ResolvedSpec = Omit<Manifest, 'assets' | 'scenes'> & {
  width: number; height: number; totalFrames: number; projectDir: string;
  assets: Record<string, ResolvedAsset>; scenes: ResolvedScene[];
  engineVersion: string; sceneVersion: string; fontsHash?: string; browserVersion?: string;
};
export type ToolPaths = { chrome: string; ffmpeg: string; ffprobe: string };
export type AudioResult = { path?: string; report: Record<string, unknown> };
