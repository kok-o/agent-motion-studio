import type { Scene } from '../src/types.js';

export const sourceAudioFields = ['source-audio-enabled', 'source-audio-gain'] as const;
type Values = Record<string, string>;
type SourceAudio = NonNullable<Scene['sourceAudio']>;

export function sourceAudioValues(scene: Scene): Values {
  return { 'source-audio-enabled': scene.sourceAudio?.enabled ? 'on' : 'off', 'source-audio-gain': String(scene.sourceAudio?.gainDb ?? 0) };
}

/** Unrelated edits never materialize a default sourceAudio field. */
export function sourceAudioPatch(scene: Scene, base: Values, values: Values): SourceAudio | undefined {
  const accepted = sourceAudioValues(scene);
  if (scene.type !== 'video' || sourceAudioFields.every(id => (base[id] ?? accepted[id]) === (values[id] ?? accepted[id]))) return undefined;
  const enabled = values['source-audio-enabled'] ?? accepted['source-audio-enabled'], gainDb = Number(values['source-audio-gain'] ?? accepted['source-audio-gain']);
  if (!['on', 'off'].includes(enabled) || !Number.isFinite(gainDb) || gainDb < -60 || gainDb > 0) throw new Error('Source audio needs Off/On and a gain between -60 and 0 dB.');
  return { enabled: enabled === 'on', gainDb };
}

/** Preserve each externally changed sibling unless the user changed that exact field. */
export function mergeSourceAudioConflict(local: SourceAudio, base: Values, values: Values, external: Scene): SourceAudio {
  return {
    enabled: base['source-audio-enabled'] === values['source-audio-enabled'] ? external.sourceAudio?.enabled ?? false : local.enabled,
    gainDb: base['source-audio-gain'] === values['source-audio-gain'] ? external.sourceAudio?.gainDb ?? 0 : local.gainDb ?? 0,
  };
}
