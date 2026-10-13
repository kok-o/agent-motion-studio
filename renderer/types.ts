import type { visualSpec } from '../src/visual-editor.js';
import type { ResolvedScene, TextLayout } from '../src/types.js';
import type { StyleTextInput, StyleTextFit } from '../src/style-types.js';

/** Actual path-free native Canvas input shared by Studio and the renderer. */
export type NativeRenderSpec = ReturnType<typeof visualSpec>;
export interface NativeRenderer {
  initialize(snapshot: NativeRenderSpec): Promise<{ scenes: ResolvedScene[]; captionLayouts: [string, TextLayout][] }>;
  renderFrame(globalFrame: number): string;
  renderSheet(indices: number[]): string;
  fitStyleText(inputs: StyleTextInput[]): Promise<StyleTextFit[]>;
}
declare global { interface Window { studio?: NativeRenderer } }
