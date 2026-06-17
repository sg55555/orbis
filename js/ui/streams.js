// 下部の YouTube Live バー。1画面再生＋チャンネル選択＋本拠地flyTo。
// 純粋ヘルパ（URL生成・選択ロジック）＋描画（renderStreams/wireStreamsCollapse）。

// キー不要のライブ埋め込みURL（autoplay はミュート必須・iOS向け playsinline）。
export function buildEmbedUrl(channel) {
  return `https://www.youtube.com/embed/live_stream?channel=${channel.channel_id}&autoplay=1&mute=1&playsinline=1`;
}

export function defaultChannel(channels) {
  return (Array.isArray(channels) && channels.length) ? channels[0] : null;
}

export function channelById(channels, id) {
  return (Array.isArray(channels) ? channels : []).find((c) => c.id === id) || null;
}

// バーを描画。onSelect(channel) はタブ選択時に呼ばれる（flyTo 等）。
// 返り値 API: select(id) / setOpen(open) / currentId()。
export function renderStreams(rootEl, channels, { onSelect } = {}) {
  const frame = rootEl.querySelector('#stream-frame');
  const tabsEl = rootEl.querySelector('#stream-tabs');
  const nowEl = rootEl.querySelector('.stream-now');
  let currentId = defaultChannel(channels) ? defaultChannel(channels).id : null;

  tabsEl.innerHTML = '';
  for (const ch of channels) {
    const b = document.createElement('button');
    b.className = 'stream-tab';
    b.dataset.id = ch.id;
    b.textContent = ch.name;
    b.addEventListener('click', () => select(ch.id));
    tabsEl.appendChild(b);
  }

  function highlight() {
    tabsEl.querySelectorAll('.stream-tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.id === currentId);
    });
  }
  function isOpen() { return !rootEl.classList.contains('collapsed'); }
  function setNow(ch) { if (nowEl && ch) nowEl.textContent = `${ch.name}｜${ch.region}`; }

  function select(id) {
    const ch = channelById(channels, id);
    if (!ch) return;
    currentId = id;
    highlight();
    setNow(ch);
    if (isOpen()) frame.src = buildEmbedUrl(ch); // 開いている時だけ再生
    if (onSelect) onSelect(ch);
  }

  highlight();
  setNow(channelById(channels, currentId));

  return {
    select,
    currentId: () => currentId,
    // 折りたたみ開閉に応じて再生を制御（隠れた所での再生を避ける）。
    setOpen(open) {
      const ch = channelById(channels, currentId);
      if (open && ch) frame.src = buildEmbedUrl(ch);
      else frame.src = '';
    },
  };
}

// 折りたたみトグルの配線。api は renderStreams の返り値。
export function wireStreamsCollapse(barEl, btnEl, api) {
  btnEl.addEventListener('click', () => {
    barEl.classList.toggle('collapsed');
    api.setOpen(!barEl.classList.contains('collapsed'));
  });
}
