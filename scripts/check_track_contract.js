#!/usr/bin/env node
/**
 * 埋点契约校验（联调 / CI 用）：
 *   1. 两侧生成产物与目录版本、事件集合一致；
 *   2. 扫描客户端源码中的字面量 track('xxx') / trackEvent('xxx') 调用，
 *      发现目录之外的新事件名时报错（防“客户端先跑、服务端拒收”）。
 * 退出码 0 = 一致；非 0 = 契约漂移。
 */
const fs = require('fs');
const path = require('path');

const workspaceRoot = path.resolve(__dirname, '..');
const catalogPath = path.join(workspaceRoot, 'analytics', 'track-events.json');
const clientOutPath = path.join(workspaceRoot, 'assets', 'scripts', 'TrackEvents.ts');
const serviceOutPath = path.join(workspaceRoot, '..', 'service', 'src', 'track', 'track-events.gen.ts');
const scriptsRoot = path.join(workspaceRoot, 'assets', 'scripts');

const failures = [];

function readNames(source) {
  const match = source.match(/export const TRACK_EVENT_NAMES = \[([\s\S]*?)\] as const;/);
  if (!match) return null;
  return match[1].split('\n')
    .map(line => (line.match(/'([a-z0-9_]+)'/) || [])[1])
    .filter(Boolean);
}

function readVersion(source, constantName) {
  const match = source.match(new RegExp(`export const ${constantName} = (\\d+);`));
  return match ? Number(match[1]) : null;
}

const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const catalogNames = catalog.events.map(event => event.name);

const clientSource = fs.readFileSync(clientOutPath, 'utf8');
const serviceSource = fs.readFileSync(serviceOutPath, 'utf8');

const clientNames = readNames(clientSource);
const serviceNames = readNames(serviceSource);
const clientVersion = readVersion(clientSource, 'TRACK_EVENT_VERSION');
const serviceVersion = readVersion(serviceSource, 'TRACK_EVENT_CATALOG_VERSION');

if (clientVersion !== catalog.version) failures.push(`客户端产物版本 ${clientVersion} ≠ 目录版本 ${catalog.version}`);
if (serviceVersion !== catalog.version) failures.push(`服务端产物版本 ${serviceVersion} ≠ 目录版本 ${catalog.version}`);
if (!clientNames) failures.push('客户端产物缺少 TRACK_EVENT_NAMES');
if (!serviceNames) failures.push('服务端产物缺少 TRACK_EVENT_NAMES');

for (const [label, names] of [['客户端', clientNames], ['服务端', serviceNames]]) {
  if (!names) continue;
  const missing = catalogNames.filter(name => !names.includes(name));
  const extra = names.filter(name => !catalogNames.includes(name));
  if (missing.length) failures.push(`${label}产物缺少事件：${missing.join(', ')}`);
  if (extra.length) failures.push(`${label}产物多出事件：${extra.join(', ')}`);
}

// 扫描客户端源码字面量调用（track('x' / trackEvent('x' / onTrack?.('x'），
// 排除已废弃目录之外的旧名调用，发现未知事件名即报错。
const callPattern = /\b(?:track|trackEvent)\(\s*'([a-z0-9_]+)'/g;
const referenced = new Map();
function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scan(full);
      continue;
    }
    if (!entry.name.endsWith('.ts') || entry.name === 'TrackEvents.ts') continue;
    const source = fs.readFileSync(full, 'utf8');
    let match;
    while ((match = callPattern.exec(source))) {
      if (!referenced.has(match[1])) referenced.set(match[1], []);
      referenced.get(match[1]).push(path.relative(scriptsRoot, full));
    }
  }
}
scan(scriptsRoot);
const catalogSet = new Set(catalogNames);
const unknown = [...referenced.keys()].filter(name => !catalogSet.has(name));
if (unknown.length) {
  for (const name of unknown) {
    failures.push(`客户端出现目录之外的埋点调用 '${name}'（${referenced.get(name).join(', ')}），请先登记 analytics/track-events.json`);
  }
}

if (failures.length) {
  console.error('[track-contract] 契约校验失败：');
  failures.forEach(line => console.error(`  - ${line}`));
  process.exit(1);
}
console.log(`[track-contract] 通过：目录 v${catalog.version}，${catalogNames.length} 个事件，客户端/服务端产物一致，无未知调用。`);
