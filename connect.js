// uWallet ⇄ Nostr extension bridge.
//
// uWallet opens this page as …/#ext=<extension id>&s=<session>&op=<link|login|unlink|address|…>.
// The page connects to uWallet (externally_connectable) and answers its requests by
// calling the NIP-07 provider (window.nostr) that the user's Nostr extension adds.
// It holds no logic of its own and never contacts a server. What each signature means is
// read from the event itself, not from what uWallet says.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.hash.slice(1));
  const ext = params.get('ext') || '';
  const session = params.get('s') || '';
  const op = params.get('op') || '';

  // ---------- copy ----------
  const COPY = {
    link: ['Link to Nostr', 'Back up this wallet to your Nostr account, encrypted.'],
    login: ['Log in with Nostr', 'Open your uWallet with your Nostr key.'],
    unlink: ['Unlink from Nostr', 'Remove this wallet’s backup from your Nostr account.'],
    address: ['Your Lightning address', 'Publish an address that belongs to your Nostr key.'],
  };
  const PLAN = {
    link: [['connect', 'Connect your Nostr key'], ['sign', 'Encrypt your backup'], ['save', 'Save it to your relays']],
    login: [['connect', 'Connect your Nostr key'], ['find', 'Find your wallet'], ['open', 'Unlock it']],
    unlink: [['connect', 'Connect your Nostr key'], ['sign', 'Sign the removal'], ['save', 'Update your relays']],
    address: [['connect', 'Connect your Nostr key'], ['prepare', 'Prepare your address'], ['sign', 'Approve two signatures'], ['upload', 'Store it on several servers'], ['publish', 'Publish it'], ['verify', 'Check it works']],
  };

  // ---------- icons ----------
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

  // ---------- small DOM helpers ----------
  const h = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'html') e.innerHTML = v; // only ever our own static icon markup
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
    return e;
  };
  const card = document.querySelector('.card');
  const mood = (m) => {
    card.classList.toggle('busy', m === 'busy');
    card.classList.toggle('ok', m === 'ok');
  };
  const panel = (...nodes) => $('panel').replaceChildren(...nodes);
  const box = (kind, icon, title, text, ...rest) =>
    h('div', { class: `box ${kind}` }, h('div', { class: 'box-head' }, h('span', { class: 'box-ic', html: icon }), h('div', { class: 'box-t' }, h('b', {}, title), text ? h('span', {}, text) : null)), ...rest);
  const waitBox = (text) => box('', '<span class="spin"></span>', text, '');
  const more = (label, items) => (items.length ? h('details', { class: 'more' }, h('summary', {}, label), h('ul', {}, items.map(([t, code]) => h('li', { class: code ? 'code' : undefined }, t)))) : null);

  // The trust list is written once in the side panel; the phone layout shows a copy.
  document.querySelector('.trust-m .trust').replaceChildren(...[...document.querySelectorAll('.side .trust li')].map((li) => li.cloneNode(true)));

  // ---------- steps ----------
  const steps = [];
  const addStep = (key, label) => {
    const li = h('li', {}, h('span', { class: 'dot', html: IC.check }), h('span', { class: 'lbl' }, label), h('span', { class: 'sub' }));
    $('steps').append(li);
    const s = { key, li };
    steps.push(s);
    return s;
  };
  let active = null;
  const goStep = (key, label) => {
    let s = steps.find((x) => x.key === key && !x.li.classList.contains('done'));
    if (!s) s = addStep(key, label || key);
    else if (label) s.li.querySelector('.lbl').textContent = label;
    for (const x of steps) {
      if (x === s) break;
      x.li.classList.remove('active', 'failed');
      x.li.classList.add('done');
      x.li.querySelector('.sub').textContent = '';
    }
    s.li.classList.remove('failed');
    s.li.classList.add('active');
    active = s;
  };
  const sub = (t) => active && (active.li.querySelector('.sub').textContent = t || '');
  const allDone = () => steps.forEach((x) => (x.li.classList.remove('active', 'failed'), x.li.classList.add('done'), (x.li.querySelector('.sub').textContent = '')));
  const failStep = () => active && (active.li.classList.remove('active'), active.li.classList.add('failed'));
  const resetSteps = () => {
    for (const x of steps) {
      x.li.className = '';
      x.li.querySelector('.sub').textContent = '';
    }
    active = null;
  };

  // ---------- what a signature means (from the event itself) ----------
  const tags = (e, n) => (e.tags || []).filter((t) => t[0] === n).map((t) => t[1]);
  const clock = (unix) => new Date(Number(unix) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const describe = (e) => {
    if (!e || typeof e !== 'object') return ['Sign a Nostr event', '', []];
    const k = e.kind;
    if (k === 30078 && tags(e, 'd')[0] === 'uwallet-backup') {
      if (tags(e, 'deleted').length || !e.content) return ['Sign the backup removal', 'Replaces your wallet backup with an empty one.', [[`Kind ${k} · app data “uwallet-backup”`, 1]]];
      return ['Sign your encrypted backup', 'Only your Nostr key can open it.', [['Your 12 words, encrypted to your own key (NIP-44).'], ['Stored on your relays as private app data.'], [`Kind ${k} · app data “uwallet-backup”`, 1]]];
    }
    if (k === 24242) {
      const servers = tags(e, 'server');
      const n = tags(e, 'x').length;
      const exp = tags(e, 'expiration')[0];
      return ['Allow the upload', `${n} small file${n === 1 ? '' : 's'} to ${servers.length || 'any'} server${servers.length === 1 ? '' : 's'}${exp ? `, until ${clock(exp)}` : ''}.`, [
        [`Only these exact ${n === 1 ? 'file' : 'files'}, matched by fingerprint.`],
        [servers.length ? `Servers: ${servers.join(', ')}` : 'Any Blossom server.'],
        [`Kind ${k} · Blossom upload permission`, 1],
      ]];
    }
    if (k === 35128 || k === 15128) {
      const paths = (e.tags || []).filter((t) => t[0] === 'path').map((t) => t[1]);
      const name = (paths.find((p) => p.startsWith('/.well-known/lnurlp/')) || '').split('/')[3];
      return ['Sign your address', name ? `Publishes ${name}@… pointing to your uWallet.` : 'Publishes your site.', [
        [`Files: ${paths.join(', ')}`],
        [`Stored on ${tags(e, 'server').length} servers. Publishing again replaces it.`],
        [`Kind ${k} · Nostr site “${tags(e, 'd')[0] || 'root'}”`, 1],
      ]];
    }
    return [`Sign a Nostr event (kind ${k})`, String(e.content || '').slice(0, 120), []];
  };

  // ---------- page setup ----------
  const valid = /^[a-p]{32}$/.test(ext) && /^[A-Za-z0-9_-]{16,64}$/.test(session) && /^[a-z-]{1,24}$/.test(op);
  if (!valid) {
    $('title').textContent = 'Open this from uWallet';
    $('lead').textContent = 'uWallet opens this page when you use Nostr in the wallet.';
    return;
  }
  const [title, lead] = COPY[op] || ['Continue with Nostr', 'uWallet needs your Nostr extension for this.'];
  $('title').textContent = title;
  $('lead').textContent = lead;
  document.title = `${title} · uWallet`;
  for (const [k, l] of PLAN[op] || []) addStep(k, l);

  const showWho = (w) => {
    if (!w || typeof w.npub !== 'string') return;
    const name = typeof w.name === 'string' && w.name.trim() ? w.name.trim().slice(0, 60) : 'Nostr account';
    $('who').hidden = false;
    $('who-name').textContent = name;
    $('who-npub').textContent = `${w.npub.slice(0, 12)}…${w.npub.slice(-6)}`;
    const initial = (name.match(/[\p{L}\p{N}]/u) || ['N'])[0].toUpperCase();
    $('who-av').textContent = initial;
    $('key-node').textContent = initial;
  };

  // ---------- Nostr extension ----------
  const waitForNostr = async () => {
    for (let i = 0; i < 50 && !window.nostr; i++) await new Promise((r) => setTimeout(r, 100));
    return window.nostr;
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
      mood('');
      const done = (v) => {
        panel();
        mood('busy');
        resolve(v);
      };
      const yes = h('button', { class: 'btn primary', onclick: () => done(true) }, String(q.yes || 'Continue'));
      panel(
        box('', IC.help, String(q.text || 'Continue?'), Array.isArray(q.points) ? q.points.map(String).join(' ') : '',
          h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => done(false) }, String(q.no || 'Cancel')), yes)),
      );
      yes.focus();
    });

  const approveBox = (m) => {
    if (m.method === 'getPublicKey') return box('approve', IC.key, 'Share your public key', 'Approve in your Nostr extension. Your public key is already public.');
    if (m.method === 'nip44.decrypt') return box('approve', IC.lock, 'Unlock your wallet backup', 'Approve in your Nostr extension. It decrypts the backup for uWallet.');
    const [t, s, items] = describe(m.params && m.params.event);
    return box('approve', IC.pen, t, `${s} Approve in your Nostr extension.`.trim(), more('What you’re signing', items));
  };

  // ---------- connection to uWallet ----------
  let port = null;
  let finished = false;
  const fail = (text, retry) => {
    mood('');
    failStep();
    const actions = h('div', { class: 'row' });
    if (retry) actions.append(h('button', { class: 'btn primary', onclick: retry }, 'Try again'));
    panel(box('bad', IC.alert, 'That didn’t work', text, retry ? actions : null));
  };

  const connect = () => {
    resetSteps();
    mood('busy');
    panel(waitBox('Connecting to uWallet…'));
    try {
      port = chrome.runtime.connect(ext, { name: 'uwallet-companion' });
    } catch {
      return fail('Couldn’t reach uWallet. Make sure the extension is installed and turned on, then start again from uWallet.');
    }
    const p = port;
    const ping = setInterval(() => p.postMessage({ ping: 1 }), 15000);
    p.onDisconnect.addListener(() => {
      clearInterval(ping);
      if (port !== p) return;
      port = null;
      if (!finished) fail('uWallet ended the session. Start again from uWallet.');
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
        mood('ok');
        return panel(box('done', IC.check, String(m.done), 'Taking you back to uWallet…'));
      }
      if (m.fail) return fail(String(m.fail), () => {
        resetSteps();
        mood('busy');
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

  // ---------- start ----------
  mood('busy');
  panel(waitBox('Looking for your Nostr extension…'));
  waitForNostr().then((n) => {
    if (n) return connect();
    mood('');
    panel(
      box('bad', IC.plug, 'No Nostr extension found', 'Install one, then reload this page.',
        h('div', { class: 'links' },
          h('a', { href: 'https://getalby.com/', target: '_blank', rel: 'noreferrer' }, 'Alby'),
          h('a', { href: 'https://chromewebstore.google.com/detail/nos2x/kpgefcfmnafjgpblomihpgmejjdanjjp', target: '_blank', rel: 'noreferrer' }, 'nos2x'),
          h('a', { href: 'https://keys.band/', target: '_blank', rel: 'noreferrer' }, 'Keys.band')),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => location.reload() }, 'Reload'))),
    );
  });
})();
