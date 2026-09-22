import { assert, ENDINGS, validateScenario } from './model.js';

/**
 * World data contract (canonical).
 * data/worlds.json is WorldEntry[]. When absent, only Joseph is offered.
 * @typedef {{id:string,title:string,intro:string}} WorldEntry
 * @typedef {{id:string,title:string,intro:string,startEvent:string,character:object,au:object,endingDescriptions:Object<string,{title:string,description:string}>,events:import('./model.js').Event[],playerContext?:{role:string,profile:string},supportingCharacters?:Object<string,{character:object,au:object}>}} Route
 * Route files live only at data/routes/<id>.json; event IDs are world-local.
 * A route supplies one adult character and its AU placement, not numeric effects.
 * Base Joseph effects are retargeted and coincident NPC values added together.
 * config.activeCharacterId is the selected world ID. Additional states require
 * state.worldId; legacy Joseph states and records remain unchanged (save v1).
 * Each world has its own slots/meta/import generation; backups identify worldId.
 * playerContext changes only the player role/profile, e.g. after graduation.
 * supportingCharacters adds adult friendship NPCs; existing player, active and
 * base characters cannot be overwritten. config.supportingCharacterIds records
 * these explicit additions for speaker/state validation; all remain non-romantic.
 */
export const validWorldId = id => typeof id === 'string' && /^[a-z][a-z0-9_]*$/.test(id)
  && !['player', 'narrator', 'constructor', 'prototype', '__proto__'].includes(id);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 20000) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
export const defaultWorlds = config => [{
  id: 'joseph', title: config.title,
  intro: '課題のあと、昼休み、帰り道。\n何でもない時間を、ジョセフと重ねていく。\nどんな関係にも、その先の日常がある。'
}];

export function validateWorlds(worlds) {
  assert(Array.isArray(worlds) && worlds.length > 0, '世界の一覧がありません');
  assert(new Set(worlds.map(world => world?.id)).size === worlds.length, '世界IDが重複しています');
  assert(worlds.some(world => world?.id === 'joseph'), 'ジョセフの世界が一覧にありません');
  for (const world of worlds) {
    assert(object(world) && validWorldId(world.id) && text(world.title, 200) && text(world.intro), '世界の情報が不正です');
  }
  return true;
}

export function loadWorldConfig(baseConfig, baseEvents, worlds, id, route) {
  validateWorlds(worlds);
  assert(validWorldId(id) && worlds.some(world => world.id === id), '未知の世界です');
  const entry = worlds.find(world => world.id === id);
  if (id === 'joseph') {
    validateScenario(baseConfig, baseEvents);
    return { config: structuredClone(baseConfig), events: structuredClone(baseEvents), world: entry };
  }
  assert(object(route) && route.id === id && text(route.title, 200) && text(route.intro)
    && text(route.startEvent, 100), '世界のシナリオ情報が不正です');
  assert(object(route.character) && text(route.character.name, 100) && route.character.adult === true, '対象人物が不正です');
  assert(route.character.heightCm === null || Number.isFinite(route.character.heightCm) && route.character.heightCm > 0, '身長情報が不正です');
  assert(object(route.au) && object(route.endingDescriptions), '世界の設定が不足しています');
  assert(Object.keys(route.endingDescriptions).sort().join(',') === [...ENDINGS].sort().join(','), '6エンドの説明が必要です');
  for (const value of Object.values(route.endingDescriptions)) {
    assert(object(value) && text(value.title, 200) && text(value.description), 'エンドの説明が不正です');
  }
  const config = structuredClone(baseConfig);
  config.activeCharacterId = id;
  config.title = route.title;
  config.startEvent = route.startEvent;
  config.characters[id] = structuredClone(route.character);
  config.auCharacters[id] = structuredClone(route.au);
  config.endingDescriptions = structuredClone(route.endingDescriptions);
  if (route.playerContext !== undefined) {
    assert(object(route.playerContext) && text(route.playerContext.role) && text(route.playerContext.profile), '主人公の場面設定が不正です');
    config.auCharacters.player.role = route.playerContext.role;
    config.characters.player.profile = route.playerContext.profile;
  }
  if (route.supportingCharacters !== undefined) {
    assert(object(route.supportingCharacters), '友情人物の設定が不正です');
    config.supportingCharacterIds = [];
    for (const [character, value] of Object.entries(route.supportingCharacters)) {
      assert(validWorldId(character) && !Object.hasOwn(config.characters, character), '友情人物の上書きは禁止です');
      assert(object(value) && object(value.character) && value.character.adult === true
        && text(value.character.name, 100) && object(value.au), '友情人物の情報が不正です');
      assert(value.character.heightCm === null || Number.isFinite(value.character.heightCm) && value.character.heightCm > 0, '友情人物の身長情報が不正です');
      config.supportingCharacterIds.push(character);
      config.characters[character] = structuredClone(value.character);
      config.auCharacters[character] = structuredClone(value.au);
    }
  }
  for (const [character, au] of Object.entries(config.auCharacters)) au.routeEnabled = character === id;
  config.effects = Object.fromEntries(Object.entries(baseConfig.effects).map(([name, effect]) => {
    const mapped = {};
    for (const [character, changes] of Object.entries(effect)) {
      const target = character === 'joseph' ? id : character;
      mapped[target] ??= {};
      for (const [key, value] of Object.entries(changes)) mapped[target][key] = (mapped[target][key] ?? 0) + value;
    }
    return [name, mapped];
  }));
  const events = structuredClone(route.events);
  validateScenario(config, events);
  return {config, events, world: {id, title: route.title, intro: route.intro}};
}
