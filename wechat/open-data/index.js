/* 好友数据只在微信开放数据域读取，不回传主域或自建服务器。 */
const canvas = wx.getSharedCanvas();
const context = canvas.getContext('2d');
let visible = false;
let rows = [];
let page = 0;
let generation = 0;
let message = '正在邀请好友的星星来集合…';
let viewport = null;
function draw() {
  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);
  if (!visible) return;
  const scale = width / 660;
  context.save(); context.scale(scale, scale);
  const designHeight = height / scale;
  context.fillStyle = '#FFF8E2'; context.fillRect(0, 0, 660, designHeight);
  context.textAlign = 'center'; context.fillStyle = '#704528'; context.font = '24px sans-serif';
  if (!rows.length) {
    context.fillText(message, 330, 110);
    context.font = '21px sans-serif'; context.fillText('累计星星越多，好友名次越高', 330, 154);
    context.restore(); return;
  }
  const capacity = Math.max(1, Math.floor((designHeight - 88) / 104));
  page = Math.max(0, Math.min(Math.ceil(rows.length / capacity) - 1, page));
  rows.slice(page * capacity, (page + 1) * capacity).forEach((row, index) => {
    const y = 28 + index * 104;
    context.fillStyle = index % 2 ? '#FFF8E2' : '#FFEFBF'; context.fillRect(16, y, 628, 88);
    context.fillStyle = '#704528'; context.font = '24px sans-serif'; context.textAlign = 'left';
    context.fillText(String(page * capacity + index + 1), 38, y + 54);
    context.fillText(row.name, 106, y + 54);
    context.textAlign = 'right'; context.fillText(`${row.stars} 星`, 616, y + 54);
  });
  context.textAlign = 'center'; context.font = '21px sans-serif'; context.fillStyle = '#704528';
  context.fillText(`‹ 上一页       ${page + 1}/${Math.ceil(rows.length / capacity)}       下一页 ›`, 330, designHeight - 30);
  context.restore();
}
wx.onMessage(data => {
  if (data.type === 'engine' && data.event === 'viewport') { viewport = data; draw(); return; }
  if (data.type === 'hide') { visible = false; generation += 1; draw(); return; }
  if (data.type !== 'friend_stars') return;
  visible = true; rows = []; page = 0; message = '正在读取好友星星…'; draw();
  const token = ++generation;
  wx.getFriendCloudStorage({
    keyList: ['cat_world_stars'],
    success(result) {
      if (token !== generation || !visible) return;
      rows = (result.data || []).map(friend => {
        const entry = (friend.KVDataList || []).find(item => item.key === 'cat_world_stars');
        return { name: String(friend.nickname || '猫咪的朋友').slice(0, 9), stars: Math.max(0, Number(entry && entry.value) || 0) };
      }).sort((left, right) => right.stars - left.stars);
      message = '好友们还没有留下星星，邀请一起玩吧'; draw();
    },
    fail() { if (token === generation) { message = '好友榜暂时没准备好，返回后重试吧'; draw(); } },
  });
});
wx.onTouchEnd(event => {
  if (!visible || !viewport || !rows.length) return;
  const touch = event.changedTouches && event.changedTouches[0];
  if (!touch) return;
  const x = (touch.clientX - viewport.x) / viewport.width;
  const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  const top = windowInfo.windowHeight - viewport.y - viewport.height;
  const y = (touch.clientY - top) / viewport.height;
  if (x < 0 || x > 1 || y < 0.84 || y > 1) return;
  page += x < 0.5 ? -1 : 1; draw();
});
