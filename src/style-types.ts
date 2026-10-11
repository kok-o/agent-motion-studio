import type { CompositionObject, Scene } from './types.js';
import type { ProjectAction } from './project.js';

export const styleIDs = ['calm-product', 'kinetic-poster', 'editorial'] as const;
export type StyleID = typeof styleIDs[number];
export const styleGroups = ['layout', 'typography', 'motion'] as const;
export type StyleGroup = typeof styleGroups[number];
export const styleRoles = ['headline', 'body', 'proof', 'media', 'accent'] as const;
export type StyleRole = typeof styleRoles[number];
export type StyleField = 'x' | 'y' | 'width' | 'height' | 'fontSize' | 'weight' | 'align' | 'color' | 'opacity' | 'reveal' | 'rotation' | 'keyframes';
export interface StyleRequest {
  styleId: StyleID;
  version: 1;
  mode: 'create' | 'restyle';
  sceneId: string;
  objectId?: string;
  text?: 'Новый текст' | 'New text';
  groups: StyleGroup[];
  roles: Record<string, StyleRole>;
  protected?: Record<string, (StyleField | '*')[]>;
  replaceTracks?: boolean;
  motion?: 'standard' | 'reduced';
}
export interface StylePackage {
  schemaVersion: 1; id: StyleID; version: 1; label: string;
  instruction: string;
  families: string[];
  typography: { headline: number; proof: number; body: number; minimum: number; weights: Record<'headline' | 'proof' | 'body', 400 | 700>; align: 'left' | 'center' | 'right' };
  motion: { arrival: number; stagger: number; distance: number; easing: 'outCubic' | 'inOutCubic'; revealShortProof: boolean };
  readability: { minimumHoldFrames: number; framesPerWord: number; framesPerCharacter: number; contrast: number };
  provenance: { source: string; commit: string; paths: string[]; ids: string[]; adaptation: string }[];
}
export type StyleAction = Extract<ProjectAction, {type:'edit-scene' | 'add-scene'}>;
export interface StyleTextFit { objectId: string; fontSize: number; lines: string[]; lineHeight: number }
export interface StyleTextInput { object: CompositionObject; minimum: number; maximum: number }
export interface StyleAudit {
  status: 'PASS' | 'PASS_WITH_WARNINGS';
  font: 'Actual bundled StudioSans 400/700, native Canvas wrapping';
  layoutFamily: string;
  checkedFrames: number;
  text: (StyleTextFit & { holdFrames: number; requiredHoldFrames: number; contrast: number | 'UNKNOWN' })[];
  warnings: string[];
  preservedTracks: string[];
  humanArtisticAcceptance: 'NOT RUN';
}
export interface CompiledStyle { request: StyleRequest; action: StyleAction; scene: Scene; audit: StyleAudit; package: StylePackage }
