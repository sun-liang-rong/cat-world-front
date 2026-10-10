#!/usr/bin/env node
// Cocos 构建完成后运行：补齐开放数据域和适合弱网恢复的超时。
const fs = require('fs');
const path = require('path');
const project = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[2] || path.join(project, 'build/wechatgame'));
const configPath = path.join(output, 'game.json');
if (!fs.existsSync(configPath)) throw new Error('请先在 Cocos Creator 构建微信小游戏，再运行本脚本');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
config.openDataContext = 'open-data';
config.networkTimeout = { ...config.networkTimeout, request: 12000, downloadFile: 20000 };
fs.mkdirSync(path.join(output, 'open-data'), { recursive: true });
fs.copyFileSync(path.join(project, 'wechat/open-data/index.js'), path.join(output, 'open-data/index.js'));
fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
console.log('[CatWorld] 已准备开放数据域与网络超时：' + output);
