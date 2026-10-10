#!/usr/bin/env node
/**
 * 埋点契约生成器：analytics/track-events.json（单一事实源）→
 *   1. cat-world/assets/scripts/TrackEvents.ts   （客户端事件名类型）
 *   2. cat-world/../service/src/track/track-events.gen.ts（服务端允许集合）
 * 两侧产物都提交到各自 Git 仓库；运行 cat-world/scripts/check_track_contract.js 比对一致性。
 */
const fs = require('fs');
const path = require('path');

const workspaceRoot = path.resolve(__dirname, '..');
const catalogPath = path.join(workspaceRoot, 'analytics', 'track-events.json');
const clientOutPath = path.join(workspaceRoot, 'assets', 'scripts', 'TrackEvents.ts');
const serviceOutPath = path.join(workspaceRoot, '..', 'service', 'src', 'track', 'track-events.gen.ts');

const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
if (!Array.isArray(catalog.events) || catalog.events.length === 0) {
  throw new Error(`事件目录为空：${catalogPath}`);
}
const names = catalog.events.map(event => event.name);
const duplicated = names.find((name, index) => names.indexOf(name) !== index);
if (duplicated) throw new Error(`事件目录存在重复事件名：${duplicated}`);
names.forEach((name) => {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error(`非法事件名：${name}`);
});

const schemas = Object.fromEntries(catalog.events.map(event => [event.name,
  Object.fromEntries(Object.entries(event.props || {}).map(([key, rule]) => [key, typeof rule === 'string' ? rule : rule.type])),
]));
const schemaSource = `export const TRACK_PROP_SCHEMAS: Record<TrackEventName, Record<string, string>> = ${JSON.stringify(schemas, null, 2)};`;

const banner = (sourceNote) => [
  `// 由 cat-world/scripts/generate_track_contract.js 从 analytics/track-events.json 生成，勿手改。`,
  `// 目录版本 v${catalog.version}；${sourceNote}`,
  '',
].join('\n');

const clientSource = [
  banner('客户端 TrackEventName / TrackProps 类型。'),
  `export const TRACK_EVENT_VERSION = ${catalog.version};`,
  '',
  'export const TRACK_EVENT_NAMES = [',
  ...names.map(name => `  '${name}',`),
  '] as const;',
  '',
  'export type TrackEventName = (typeof TRACK_EVENT_NAMES)[number];',
  '',
  schemaSource,
  '',
  '/** 允许上报的事件属性类型：仅有限原语，禁止任意对象。 */',
  'export type TrackProps = Record<string, string | number | boolean | string[] | null>;',
  '',
].join('\n');

const serviceSource = [
  banner('服务端事件允许集合；结构校验逻辑在 track-events.ts。'),
  `export const TRACK_EVENT_CATALOG_VERSION = ${catalog.version};`,
  '',
  'export const TRACK_EVENT_NAMES = [',
  ...names.map(name => `  '${name}',`),
  '] as const;',
  '',
  'export type TrackEventName = (typeof TRACK_EVENT_NAMES)[number];',
  '',
  schemaSource,
  '',
].join('\n');

fs.writeFileSync(clientOutPath, clientSource);
fs.writeFileSync(serviceOutPath, serviceSource);
console.log(`[track-contract] v${catalog.version}：${names.length} 个事件`);
console.log(`[track-contract] 已生成 ${path.relative(workspaceRoot, clientOutPath)}`);
console.log(`[track-contract] 已生成 ${path.relative(path.dirname(serviceOutPath), serviceOutPath)}`);
