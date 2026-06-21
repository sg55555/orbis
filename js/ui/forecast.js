// AI FORECASTS UI（純粋ヘルパ＋描画）。globe レイヤーは作らず DOM＋flyTo。
export const DOMAIN_LABEL = { all:'ALL', conflict:'紛争', market:'市場', supply_chain:'供給網',
  political:'政治', military:'軍事', cyber:'サイバー', infra:'インフラ/災害' };
const DOMAIN_RGB = { conflict:[240,90,80], market:[120,200,120], supply_chain:[200,170,90],
  political:[150,160,240], military:[210,120,120], cyber:[120,200,230], infra:[240,190,80] };
const LEVEL_RGB = {1:[90,200,160],2:[150,210,90],3:[240,200,70],4:[245,150,60],5:[240,80,70]};
const CONF = { high:{t:'信頼度 高',c:'cf-high'}, med:{t:'信頼度 中',c:'cf-med'}, low:{t:'信頼度 低',c:'cf-low'} };

export function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,(m)=>(
  {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
export function domainColor(d){const[r,g,b]=DOMAIN_RGB[d]||[150,150,150];return`rgb(${r},${g},${b})`;}
export function levelColor(score){const[r,g,b]=LEVEL_RGB[Math.min(5,Math.max(1,1+Math.floor((score||0)/20)))];return`rgb(${r},${g},${b})`;}
export function confBadge(conf){const c=CONF[conf]||CONF.low;return`<span class="fc-conf ${c.c}">${c.t}</span>`;}
export function trendArrow(dir){return dir==='up'?'▲':dir==='down'?'▼':dir==='new'?'•':'─';}
export function filterByDomain(cards, domain){
  const list=(cards||[]).slice().sort((a,b)=>(b.attention_score||0)-(a.attention_score||0));
  return domain==='all'?list:list.filter((c)=>c.domain===domain);
}
const TAB_ORDER = ['all','conflict','political','infra','supply_chain','military','market','cyber'];
export function tabsHtml(active){
  return TAB_ORDER.map((d)=>`<button type="button" data-dom="${d}" class="fc-tab${d===active?' fc-tab-active':''}">`
    +`${esc(DOMAIN_LABEL[d]||d)}</button>`).join('');
}
export function renderForecasts(rootEl, data, { onSelect } = {}){
  if(!rootEl) return;
  const cards=(data&&data.cards)||[];
  const tabs=rootEl.querySelector('.fc-tabs');
  const list=rootEl.querySelector('.fc-list');
  if(!tabs||!list) return;
  let active='all';
  const draw=()=>{
    tabs.innerHTML=tabsHtml(active);
    list.innerHTML='';
    filterByDomain(cards, active).forEach((c)=>{
      const el=document.createElement('button'); el.type='button'; el.className='fc-cardbtn';
      el.innerHTML=cardHtml(c);
      if(typeof c.lat==='number'&&typeof c.lon==='number'&&(c.lat||c.lon)&&onSelect){
        el.addEventListener('click',()=>onSelect(c));
      } else { el.disabled=true; }
      list.appendChild(el);
    });
    tabs.querySelectorAll('.fc-tab').forEach((b)=>b.addEventListener('click',()=>{active=b.dataset.dom;draw();}));
  };
  draw();
}

export function cardHtml(card){
  const c=card||{}; const col=domainColor(c.domain);
  const sig=(c.signals||[]).map((s)=>`<span class="fc-sig">${esc(s.label)}</span>`).join('');
  if(c.status==='watch'){
    return `<div class="fc-card fc-watch" style="--dom:${col}">`
      +`<div class="fc-head"><span class="fc-dom">${esc(DOMAIN_LABEL[c.domain]||c.domain)}</span>`
      +`<span class="fc-place">${esc(c.place_ja||'')}</span></div>`
      +`<p class="fc-watchmsg">十分な信号なし・監視中</p></div>`;
  }
  const ai=c.ai_generated?'<span class="fc-ai">🤖 AI生成・推測</span>':'';
  const out=c.outlook_ja?`<p class="fc-out">${esc(c.outlook_ja)}</p>`:'';
  const rat=c.rationale_ja?`<p class="fc-rat">根拠: ${esc(c.rationale_ja)}</p>`:'';
  return `<div class="fc-card" style="--dom:${col};--lvl:${levelColor(c.attention_score)}">`
    +`<div class="fc-head"><span class="fc-dom">${esc(DOMAIN_LABEL[c.domain]||c.domain)}</span>`
    +`<span class="fc-place">${esc(c.place_ja||'')}</span>`
    +`<span class="fc-tr fc-${esc(c.trend)}">${trendArrow(c.trend)}</span></div>`
    +`<div class="fc-bar"><span class="fc-fill" style="width:${Math.max(0,Math.min(100,c.attention_score||0))}%"></span></div>`
    +`<div class="fc-meta"><span class="fc-score">注視度 ${esc(c.attention_score||0)}</span>`
    +confBadge(c.confidence)+`<span class="fc-hz">${esc(c.horizon||'')}</span>${ai}</div>`
    +`<div class="fc-sigs">${sig}</div>`+out+rat+`</div>`;
}
