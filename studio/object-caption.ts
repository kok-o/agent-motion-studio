import type { CompositionObject, Manifest } from '../src/types.js';

/** Presentation only: user IDs and every accepted field remain unchanged. */
export function objectCaption(object: CompositionObject, assets: Manifest['assets'], translate: (text: string) => string = text => text): string {
  if (!/^object-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(object.id)) return `${object.id} · ${object.type}`;
  const type = translate(object.type === 'text' ? 'Текст' : object.type === 'image' ? 'Изображение' : object.shape === 'ellipse' ? 'Эллипс' : 'Прямоугольник');
  const content = object.type === 'text' ? object.text : object.type === 'image' && object.asset ? assets[object.asset]?.name : undefined;
  const short = content?.replace(/\s+/g, ' ').trim().slice(0, 60);
  return short ? `${type} · ${short}` : type;
}
