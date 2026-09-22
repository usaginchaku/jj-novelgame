import { FORMAT_VERSION, activeCharacterId, assert, validateSave, validateMeta } from './model.js';
export const STORAGE_PREFIX = 'jojo-university:';
export const worldStoragePrefix = config => activeCharacterId(config) === 'joseph' ? STORAGE_PREFIX : STORAGE_PREFIX + 'world:' + activeCharacterId(config) + ':';
export const SAVE_SLOTS = ['auto', '1', '2', '3'];
export const emptyMeta = () => ({
  formatVersion: FORMAT_VERSION,
  playthroughCount: 0,
  endings: [],
  memories: []
});
export function createStorage(backend, config, events) {
  const worldId = activeCharacterId(config);
  const storagePrefix = worldStoragePrefix(config);
  const pointerKey = storagePrefix + 'active-import';
  function prefix() {
    const raw = backend.getItem(pointerKey);
    if (raw === null) return storagePrefix;
    assert(/^import-[a-z0-9-]+$/.test(raw), '復元管理情報が破損しています。生データを救出してください');
    const active = storagePrefix + raw + ':';
    assert(backend.getItem(active + 'meta') !== null, '復元世代が見つかりません。元データを保持しています');
    return active;
  }
  const key = slot => {
    assert(SAVE_SLOTS.includes(slot), '不明な保存枠です');
    return prefix() + 'save:' + slot;
  };
  function parse(raw, validate) {
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error('保存データが破損しています。元データは保持しています');
    }
    validate(value);
    return value;
  }
  function read(slot) {
    const raw = backend.getItem(key(slot));
    return raw === null ? null : parse(raw, v => validateSave(v, config, events));
  }
  function write(slot, state) {
    read(slot);
    const save = {
      formatVersion: FORMAT_VERSION,
      scenarioVersion: config.scenarioVersion,
      savedAt: new Date().toISOString(),
      state: structuredClone(state)
    };
    validateSave(save, config, events);
    backend.setItem(key(slot), JSON.stringify(save));
    return save;
  }
  function readMeta() {
    const raw = backend.getItem(prefix() + 'meta');
    return raw === null ? emptyMeta() : parse(raw, value => validateMeta(value, config));
  }
  function writeMeta(meta) {
    readMeta();
    validateMeta(meta, config);
    backend.setItem(prefix() + 'meta', JSON.stringify(meta));
  }
  function exportBackup() {
    return {
      kind: 'jojo-university-backup',
      worldId,
      formatVersion: FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      slots: Object.fromEntries(SAVE_SLOTS.map(slot => [slot, read(slot)])),
      meta: readMeta()
    };
  }
  function rawBackup() {
    const entries = {};
    // Real localStorage lets rescue include old generations and failed stages.
    if (typeof backend.key === 'function') {
      for (let i = 0; i < backend.length; i++) {
        const k = backend.key(i);
        if (k?.startsWith(storagePrefix) && (worldId !== 'joseph' || !k.startsWith(STORAGE_PREFIX + 'world:'))) entries[k] = backend.getItem(k);
      }
    } else {
      for (const k of [pointerKey, storagePrefix + 'last-import-backup', ...SAVE_SLOTS.map(slot => key(slot)), prefix() + 'meta']) entries[k] = backend.getItem(k);
    }
    return {
      kind: 'jojo-university-raw-rescue',
      worldId,
      formatVersion: FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      entries
    };
  }
  function validateBackup(value) {
    assert(value && typeof value === 'object' && value.kind === 'jojo-university-backup' && value.formatVersion === FORMAT_VERSION, '未対応のバックアップ形式です');
    assert((Object.hasOwn(value, 'worldId') ? value.worldId : 'joseph') === worldId, '異なる世界のバックアップです。現在の記録は変更していません');
    assert(typeof value.exportedAt === 'string' && Number.isFinite(Date.parse(value.exportedAt)), '書き出し日時が不正です');
    assert(value.slots && typeof value.slots === 'object' && !Array.isArray(value.slots) && Object.keys(value.slots).sort().join(',') === [...SAVE_SLOTS].sort().join(','), '保存枠が不足または不正です');
    for (const slot of SAVE_SLOTS) if (value.slots[slot] !== null) validateSave(value.slots[slot], config, events);
    validateMeta(value.meta, config);
    return value;
  }
  function importBackup(value) {
    validateBackup(value);
    const before = rawBackup();
    delete before.entries[storagePrefix + 'last-import-backup'];
    // Stage a complete generation and switch one pointer only after every write
    // succeeds. Failure cannot expose a partially restored set of slots/meta.
    const generation = 'import-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    const target = storagePrefix + generation + ':';
    backend.setItem(storagePrefix + 'last-import-backup', JSON.stringify(before));
    for (const slot of SAVE_SLOTS) if (value.slots[slot] !== null) backend.setItem(target + 'save:' + slot, JSON.stringify(value.slots[slot]));
    backend.setItem(target + 'meta', JSON.stringify(value.meta));
    backend.setItem(pointerKey, generation);
    return before;
  }
  return {
    read,
    write,
    readMeta,
    writeMeta,
    exportBackup,
    rawBackup,
    validateBackup,
    importBackup
  };
}
