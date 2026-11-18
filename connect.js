// uWallet ↔ Nostr bridge.
//
// uWallet opens this page (…/#ext=<id>&s=<session>&op=link|login|unlink) inside its own window,
// because Nostr extensions only work on web pages. The page connects back to uWallet and answers
// its requests with your Nostr extension (NIP-07 window.nostr): your public key, a signature on
// the encrypted backup, or decrypting that backup. What a signature means is read from the event
// itself, not from what uWallet says. The page has no server and can't send data anywhere.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.hash.slice(1));
  const ext = params.get('ext') || '';
  const session = params.get('s') || '';
  const op = params.get('op') || '';
  const inWallet = params.get('w') === '1';

  const svg = (d) => `<svg viewBox="0 0 24 24">${d}</svg>`;
  const IC = {
    check: svg('<path d="M20 6 9 17l-5-5"/>'),
    key: svg('<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/>'),
    pen: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>'),
    lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
    alert: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/>'),
    plug: svg('<path d="M9 2v6M15 2v6M7 8h10v4a5 5 0 0 1-10 0zM12 17v5"/>'),
    help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17v.01"/>'),
  };
  const h = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'html') e.innerHTML = v; // only our own static icons
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v != null && v !== false) e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
    return e;
  };
  const panel = (...nodes) => $('panel').replaceChildren(...nodes.filter(Boolean));
  const box = (kind, icon, title, text, ...rest) =>
    h('div', { class: `box ${kind}` }, h('div', { class: 'box-head' }, h('span', { class: 'box-ic', html: icon }), h('div', { class: 'box-t' }, h('b', {}, title), text ? h('span', {}, text) : null)), ...rest);
  const waitBox = (text) => box('', '<span class="spin"></span>', text, '');
  const busy = (on) => $('who').classList.toggle('busy', on);

  const COPY = {
    login: ['Log in with Nostr', 'Open your uWallet with your Nostr key.', [['connect', 'Connect your Nostr key'], ['find', 'Find your wallet'], ['open', 'Unlock it']]],
    link: ['Link to Nostr', 'Back up this wallet to your Nostr account, encrypted.', [['connect', 'Connect your Nostr key'], ['sign', 'Encrypt your backup'], ['save', 'Save it to your relays']]],
    unlink: ['Unlink from Nostr', 'Remove this wallet’s backup from your Nostr account.', [['connect', 'Connect your Nostr key'], ['sign', 'Sign the removal'], ['save', 'Update your relays']]],
  };

  if (!/^[a-p]{32}$/.test(ext) || !/^[A-Za-z0-9_-]{16,64}$/.test(session) || !COPY[op]) {
    $('title').textContent = 'uWallet';
    $('lead').textContent = 'This page connects uWallet to your Nostr extension. Open uWallet and choose Log in with Nostr.';
    return;
  }
  const [title, lead, plan] = COPY[op];
  $('title').textContent = title;
  void lead; // the title says it; the step list shows the rest
  document.title = `${title} · uWallet`;

  // ---------- steps ----------
  const newStep = (key, label) => {
    const s = { key, li: h('li', {}, h('span', { class: 'dot', html: IC.check }), h('span', { class: 'lbl' }, label), h('span', { class: 'sub' })) };
    $('steps').append(s.li);
    return s;
  };
  const steps = plan.map(([key, label]) => newStep(key, label));
  let active = null;
  const goStep = (key, label) => {
    let s = steps.find((x) => x.key === key && !x.li.classList.contains('done'));
    if (!s) steps.push((s = newStep(key, label || key)));
    else if (label) s.li.querySelector('.lbl').textContent = label;
    for (const x of steps) {
      if (x === s) break;
      x.li.className = 'done';
      x.li.querySelector('.sub').textContent = '';
    }
    s.li.className = 'active';
    active = s;
  };
  const sub = (t) => active && (active.li.querySelector('.sub').textContent = t || '');
  const allDone = () => steps.forEach((x) => ((x.li.className = 'done'), (x.li.querySelector('.sub').textContent = '')));
  const resetSteps = () => {
    steps.forEach((x) => ((x.li.className = ''), (x.li.querySelector('.sub').textContent = '')));
    active = null;
  };

  const initial = (name) => ((name || 'N').match(/[\p{L}\p{N}]/u) || ['N'])[0].toUpperCase();
  const showWho = (w) => {
    if (!w || typeof w.npub !== 'string') return;
    const name = typeof w.name === 'string' && w.name.trim() ? w.name.trim().slice(0, 60) : 'Nostr account';
    $('who-name').textContent = name;
    $('who-npub').textContent = `${w.npub.slice(0, 12)}…${w.npub.slice(-6)}`;
    const av = $('who-av');
    // The profile picture (https only); the initial until it loads or if it fails.
    av.textContent = initial(name);
    if (typeof w.picture === 'string' && /^https:\/\/\S+$/.test(w.picture) && w.picture.length < 2000) {
      const img = h('img', { alt: '', referrerpolicy: 'no-referrer' });
      img.onload = () => av.replaceChildren(img);
      img.src = w.picture;
    }
  };

  // ---------- what is being signed (read from the event) ----------
  const approveBox = (m) => {
    if (m.method === 'getPublicKey') return box('approve', IC.key, 'Share your public key', 'Approve in your Nostr extension.');
    if (m.method === 'nip44.decrypt') return box('approve', IC.lock, 'Unlock your wallet backup', 'Approve in your Nostr extension.');
    const e = (m.params && m.params.event) || {};
    const isBackup = e.kind === 30078 && (e.tags || []).some((t) => t[0] === 'd' && t[1] === 'uwallet-backup');
    if (isBackup && !e.content) return box('approve', IC.pen, 'Sign the backup removal', 'Approve in your Nostr extension. It replaces your backup with an empty one.');
    if (isBackup) return box('approve', IC.pen, 'Sign your encrypted backup', 'Approve in your Nostr extension. Only your Nostr key can open it.');
    return box('approve', IC.pen, `Sign a Nostr event (kind ${Number(e.kind)})`, 'Approve in your Nostr extension.');
  };

  const call = async (method, p) => {
    const n = window.nostr;
    if (method === 'getPublicKey') return n.getPublicKey();
    if (method === 'signEvent') return n.signEvent(p.event);
    if (method === 'nip44.decrypt') {
      if (!n.nip44 || typeof n.nip44.decrypt !== 'function') throw new Error('Your Nostr extension doesn’t support NIP-44 encryption. Update it, or use Alby, nos2x or Keys.band.');
      return n.nip44.decrypt(p.pubkey, p.ciphertext);
    }
    throw new Error('Unknown request');
  };

  const askUser = (q) =>
    new Promise((resolve) => {
      busy(false);
      const done = (v) => (document.body.classList.remove('asking'), panel(), busy(true), resolve(v));
      const title = String(q.text || 'Continue?');
      const text = Array.isArray(q.points) ? q.points.map(String).join(' ') : '';
      // A few labelled answers (e.g. create / restore / another account). Only known values pass.
      const choices = Array.isArray(q.choices) ? q.choices.filter((c) => c && (c.value === true || c.value === false || c.value === 'restore')).slice(0, 4) : [];
      if (choices.length) {
        // The question takes the place of the step list: the window is small.
        document.body.classList.add('asking');
        const chev = '<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>';
        const btns = choices.map((c) => c.primary
          ? h('button', { class: 'btn primary', onclick: () => done(c.value) }, String(c.label || ''))
          : h('button', { class: 'alt', onclick: () => done(c.value) }, h('span', {}, String(c.label || '')), h('span', { class: 'chev', html: chev })));
        panel(h('div', { class: 'ask' }, h('b', {}, title), text ? h('p', {}, text) : null, h('div', { class: 'choices' }, btns)));
        btns[0].focus();
        return;
      }
      const yes = h('button', { class: 'btn primary', onclick: () => done(true) }, String(q.yes || 'Continue'));
      panel(box('ask', IC.help, title, text, h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => done(false) }, String(q.no || 'Cancel')), yes)));
      yes.focus();
    });

  // ---------- back to uWallet ----------
  let port = null;
  let finished = false;
  // uWallet cancels this and returns its window to the wallet (a web page can't open uWallet's pages).
  const goBack = () => {
    try {
      (port || chrome.runtime.connect(ext, { name: 'uwallet-companion' })).postMessage({ back: session });
    } catch { /* uWallet unreachable */ }
    setTimeout(() => history.back(), 800);
  };
  if (inWallet) {
    $('back').hidden = false;
    $('back').onclick = goBack;
  }
  const backBtn = () => (inWallet ? h('button', { class: 'btn', onclick: goBack }, 'Back to uWallet') : null);
  const fail = (text, retry) => {
    busy(false);
    if (active) active.li.className = 'failed';
    panel(box('bad', IC.alert, 'That didn’t work', text, h('div', { class: 'row' }, backBtn(), retry ? h('button', { class: 'btn primary', onclick: retry }, 'Try again') : null)));
  };

  // ---------- session ----------
  const connect = () => {
    resetSteps();
    busy(true);
    panel(waitBox('Connecting to uWallet…'));
    try {
      port = chrome.runtime.connect(ext, { name: 'uwallet-companion' });
    } catch {
      return fail('Couldn’t reach uWallet. Go back and start again.');
    }
    const p = port;
    const ping = setInterval(() => p.postMessage({ ping: 1 }), 15000);
    p.onDisconnect.addListener(() => {
      clearInterval(ping);
      if (port !== p) return;
      port = null;
      if (!finished) fail('uWallet ended this. Go back and start again.');
    });
    p.onMessage.addListener(async (m) => {
      if (!m || typeof m !== 'object' || port !== p) return;
      if (m.who) return showWho(m.who);
      if (typeof m.step === 'string') {
        goStep(m.step, typeof m.label === 'string' ? m.label : '');
        if (!$('panel').querySelector('.approve')) panel();
        return;
      }
      if (typeof m.status === 'string') return sub(m.status);
      if (m.done) {
        finished = true;
        allDone();
        busy(false);
        $('who').classList.add('ok');
        return panel(box('done', IC.check, String(m.done), 'Returning to uWallet…'));
      }
      if (m.fail)
        return fail(String(m.fail), () => {
          resetSteps();
          busy(true);
          panel(waitBox('Trying again…'));
          p.postMessage({ hello: session });
        });
      if (typeof m.id !== 'number') return;
      if (m.method === 'confirm') return p.postMessage({ id: m.id, result: await askUser(m.params || {}) });
      panel(approveBox(m));
      try {
        const result = await call(m.method, m.params || {});
        panel();
        p.postMessage({ id: m.id, result });
      } catch (e) {
        p.postMessage({ id: m.id, error: (e && e.message) || String(e) || 'Rejected' });
      }
    });
    p.postMessage({ hello: session });
  };

  // Start as soon as the Nostr extension shows up (they inject window.nostr shortly after load).
  busy(true);
  panel(waitBox('Looking for your Nostr extension…'));
  (async () => {
    for (let i = 0; i < 50 && !window.nostr; i++) await new Promise((r) => setTimeout(r, 100));
    if (window.nostr) return connect();
    busy(false);
    panel(box('bad', IC.plug, 'No Nostr extension found', 'Install one, then reload this page.',
      h('div', { class: 'links' },
        h('a', { href: 'https://getalby.com/', target: '_blank', rel: 'noreferrer' }, 'Alby'),
        h('a', { href: 'https://chromewebstore.google.com/detail/nos2x/kpgefcfmnafjgpblomihpgmejjdanjjp', target: '_blank', rel: 'noreferrer' }, 'nos2x'),
        h('a', { href: 'https://keys.band/', target: '_blank', rel: 'noreferrer' }, 'Keys.band')),
      h('div', { class: 'row' }, backBtn(), h('button', { class: 'btn primary', onclick: () => location.reload() }, 'Reload'))));
  })();
})();
