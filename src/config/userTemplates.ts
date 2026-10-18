'use client';

import { useSyncExternalStore } from 'react';
import type { Shot } from '@/store/editor';
import type { TemplatePatch } from '@/config/templates';

/**
 * PERSONAL TEMPLATES: stored in browser localStorage without a backend.
 * Save the scene setup, not user media, so templates can be reused with
 * other screenshots. Preserve bundled /... paths (demo/template images);
 * discard blob/data URLs to conserve quota.
 */
export type UserTemplate = { id: string; name: string; createdAt: number; backgroundId: string; apply: TemplatePatch };

const KEY = 'mockuptop:user-templates:v1';
const listeners = new Set<() => void>();
let cache: UserTemplate[] | null = null;
const EMPTY: UserTemplate[] = [];

function read(): UserTemplate[] {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(v) ? v : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(list: UserTemplate[]) {
  cache = list;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Quota/private mode: retain for this session only.
  }
  for (const l of listeners) l();
}

export function useUserTemplates(): UserTemplate[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => EMPTY,
  );
}

const keepPath = (u: string | null | undefined) => (u && u.startsWith('/') ? u : null);

export function saveUserTemplate(name: string, shot: Shot) {
  const apply: TemplatePatch = {
    deviceId: shot.deviceId,
    finishId: shot.finishId,
    camera: { ...shot.camera },
    tracks: shot.tracks,
    motionId: shot.motionId,
    light: { ...shot.light },
    scene: { ...shot.scene, bgImage: keepPath(shot.scene.bgImage) },
    blur: { ...shot.blur },
    effects: shot.effects,
    border: shot.border,
    deviceOpts: shot.deviceOpts,
    statusBar: { ...shot.statusBar },
    layoutId: shot.layoutId,
    mainSlot: shot.mainSlot,
    extras: shot.extras.map((e) => ({ ...e, media: keepPath(e.media) })),
    duration: shot.duration,
  };
  const t: UserTemplate = {
    id: `ut-${Date.now().toString(36)}`,
    /*
      Number unnamed templates so multiple "My template" entries remain
      distinguishable in the grid.
    */
    name: name.trim().slice(0, 40) || nextUntitled(read()),
    createdAt: Date.now(),
    backgroundId: shot.scene.backgroundId,
    apply,
  };
  write([t, ...read()].slice(0, 50));
}

function nextUntitled(list: UserTemplate[]): string {
  const taken = new Set(list.map((t) => t.name));
  if (!taken.has('My template')) return 'My template';
  let n = 2;
  while (taken.has(`My template ${n}`)) n++;
  return `My template ${n}`;
}

export function deleteUserTemplate(id: string) {
  write(read().filter((t) => t.id !== id));
}
