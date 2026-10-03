// ── State ──
let activeModel = null;

// Block configs per model
const MODELS = {
  '1': { blocks: ['1-1','1-2','1-3','1-4','1-5'], required: ['1-1','1-2','1-4','1-5'], label: 'Modelo #1 — Liquidez Nítida' },
  '2': { blocks: ['2-1','2-2','2-3'], required: ['2-1','2-2','2-3'], label: 'Modelo #2 — Order Block' },
  '3': { blocks: ['3-1','3-2'], required: ['3-1','3-2'], label: 'Modelo #3 — POI' },
  '4': { blocks: ['4-1','4-2','4-3','4-4'], required: ['4-1','4-2','4-3','4-4'], label: 'Modelo #4 — VWAP Trade' },
  'g': { blocks: ['g-1'], required: ['g-1'], label: 'Gestão' }
};

// ── Init dots ──
document.querySelectorAll('[data-block]').forEach(block => {
  const id = block.dataset.block;
  const max = +block.dataset.max;
  const wrap = document.getElementById(`d-${id}`);
  if (!wrap) return;
  for (let i = 0; i < max; i++) {
    const d = document.createElement('div');
    d.className = 'dot';
    wrap.appendChild(d);
  }
});

// ── Switch model ──
function switchModel(m) {
  m = String(m);
  activeModel = m;

  // tabs
  document.querySelectorAll('.mtab').forEach(t => t.classList.toggle('active', t.dataset.model === m));

  // panels
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById(`panel-${m}`);
  if (panel) panel.classList.add('active');

  // legend
  document.getElementById('legend').style.display = m !== 'g' ? 'flex' : 'none';

  updateAll();
  saveState();
}

// ── Toggle block ──
function toggleBlock(hdr) {
  hdr.closest('.block').classList.toggle('open');
}

// ── Toggle item ──
function toggleItem(item) {
  if (!item.classList.contains('chk') && item.dataset.excl) {
    if (item.dataset.excl === 'vwap-choch') {
      document.querySelectorAll('[data-excl="vwap-fffd"]').forEach(i => i.classList.remove('chk'));
    } else if (item.dataset.excl === 'vwap-fffd') {
      document.querySelectorAll('[data-excl="vwap-choch"]').forEach(i => i.classList.remove('chk'));
    }
  }
  item.classList.toggle('chk');
  updateAll();
  saveState();
}

// ── Update scores ──
function updateAll() {
  // Update all blocks regardless of active model
  document.querySelectorAll('[data-block]').forEach(block => {
    const id = block.dataset.block;
    const max = +block.dataset.max;
    const items = block.querySelectorAll('.item');
    let count = 0;
    items.forEach(i => { 
      if (i.classList.contains('chk')) {
        count += parseInt(i.dataset.weight || '1', 10);
      }
    });
    count = Math.min(count, max);

    // dots
    const dots = document.querySelectorAll(`#d-${id} .dot`);
    dots.forEach((d, idx) => d.classList.toggle('on', idx < count));

    // badge
    const badge = document.getElementById(`b-${id}`);
    if (badge) badge.textContent = `${count}/${max}`;

    // done
    block.classList.toggle('done', count === max && !block.classList.contains('gate'));
  });

  // Gate check
  const gblock = document.querySelector('[data-block="g-1"]');
  const gItems = gblock ? gblock.querySelectorAll('.item') : [];
  let gCount = 0;
  gItems.forEach(i => { if (i.classList.contains('chk')) gCount++; });
  const gMax = gblock ? +gblock.dataset.max : 3;
  const gateOk = gCount === gMax;

  document.getElementById('vetoBar').classList.toggle('show', !gateOk && activeModel && activeModel !== 'g');

  // Plano warning + tab indicator
  const planoWarn = document.getElementById('planoWarn');
  const planoTab = document.querySelector('.mtab.gate-tab');
  if (planoWarn) planoWarn.classList.toggle('hide', gateOk);
  if (planoTab) planoTab.classList.toggle('gate-done', gateOk);

  if (!activeModel || activeModel === 'g') {
    resetVerdict(gateOk);
    return;
  }

  const model = MODELS[activeModel];
  if (!model) return;

  // Count scored items (non-inv = positive; inv.chk counts as pass; bonus counts as extra)
  let scored = 0, total = 0;
  model.blocks.forEach(bid => {
    const block = document.querySelector(`[data-block="${bid}"]`);
    if (!block) return;
    const items = block.querySelectorAll('.item');
    items.forEach(item => {
      const isBonus = item.classList.contains('bonus');
      const isInv = item.classList.contains('inv');
      const chk = item.classList.contains('chk');
      const weight = parseInt(item.dataset.weight || '1', 10);

      if (!isBonus) total += weight;

      if (isInv) {
        if (chk) scored += weight; // inv checked = condition met (not invalid)
      } else if (chk) {
        scored += weight;
      }
    });
  });

  updateVerdict(scored, total, gateOk, model.label);
}

function resetVerdict(gateOk) {
  const card = document.getElementById('vcard');
  card.className = 'verdict';
  if (activeModel === 'g') {
    document.getElementById('vtxt').textContent = gateOk ? 'Plano OK · escolha modelo' : 'Preencha o Plano';
    document.getElementById('vsub').textContent = gateOk ? 'Agora vá para Modelo #1, #2 ou #3' : '';
    document.getElementById('vicon').textContent = gateOk ? '✅' : '📝';
  } else {
    document.getElementById('vtxt').textContent = 'Comece pelo Plano';
    document.getElementById('vsub').textContent = 'Passo 1: preencha o Plano de Trading';
    document.getElementById('vicon').textContent = '📋';
  }
  document.getElementById('snum').textContent = '0';
  document.getElementById('sden').textContent = '/0';
  document.getElementById('ring').style.strokeDashoffset = '169.6';
}

function updateVerdict(scored, total, gateOk, label) {
  const card = document.getElementById('vcard');
  const vtxt = document.getElementById('vtxt');
  const vsub = document.getElementById('vsub');
  const vicon = document.getElementById('vicon');
  const snum = document.getElementById('snum');
  const sden = document.getElementById('sden');
  const ring = document.getElementById('ring');

  snum.textContent = scored;
  sden.textContent = `/${total}`;

  const circ = 169.6;
  ring.style.strokeDashoffset = circ * (1 - Math.min(scored / Math.max(total, 1), 1));

  card.classList.remove('go','wait','stop');

  if (!gateOk) {
    card.classList.add('stop');
    vtxt.textContent = 'NÃO OPERA';
    vsub.textContent = '⚠️ Plano de Trading não preenchido — vá no Passo 1';
    vicon.textContent = '🚫';
  } else {
    const missing = total - scored;
    if (missing <= 0) {
      card.classList.add('go');
      vtxt.textContent = 'OPERA ✓';
      vsub.textContent = `${label} — todos critérios confirmados`;
      vicon.textContent = '🟢';
    } else if (missing <= 2) {
      card.classList.add('wait');
      vtxt.textContent = 'AGUARDA';
      vsub.textContent = `${missing} critério(s) pendente(s) — quase lá`;
      vicon.textContent = '⏳';
    } else {
      card.classList.add('stop');
      vtxt.textContent = 'NÃO OPERA';
      vsub.textContent = `${missing} critérios faltando — setup incompleto`;
      vicon.textContent = '🔴';
    }
  }

  vtxt.classList.remove('pulse');
  void vtxt.offsetWidth;
  vtxt.classList.add('pulse');
}

// ── Reset ──
document.getElementById('btnReset').addEventListener('click', () => {
  document.querySelectorAll('.item.chk').forEach(i => i.classList.remove('chk'));
  updateAll();
  saveState();
});

// ── Persist ──
function saveState() {
  const st = { model: activeModel, items: {} };
  document.querySelectorAll('.item').forEach((item, i) => {
    st.items[i] = item.classList.contains('chk');
  });
  try { localStorage.setItem('et_checklist', JSON.stringify(st)); } catch(e){}
}

function loadState() {
  try {
    const raw = localStorage.getItem('et_checklist');
    if (raw) {
      const st = JSON.parse(raw);
      document.querySelectorAll('.item').forEach((item, i) => {
        if (st.items?.[i]) item.classList.add('chk');
      });
      if (st.model) { switchModel(st.model); return; }
    }
  } catch(e){}
  // Default: open Plano de Trading first
  switchModel('g');
}

loadState();
