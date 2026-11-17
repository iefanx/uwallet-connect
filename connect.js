// uWallet Connect: the bridge between uWallet and your Nostr extension.
//
// Two modes:
//  - Session (…/#ext=<id>&s=<session>&op=<op>): uWallet opened this page to do one thing
//    (log in, link, publish an address…). The page answers uWallet's requests by calling
//    the NIP-07 provider (window.nostr). What each signature means is read from the event
//    itself, not from what uWallet says.
//  - Dashboard (no session): a summary of this wallet's Nostr setup, read from uWallet,
//    with shortcuts that open the right uWallet screen, and a guide for a custom domain.
//    The dashboard never asks for signatures and can't start anything on its own.
// The page holds no logic of its own and never contacts a server (connect-src 'none').
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.hash.slice(1));
  const session = params.get('s') || '';
  const op = params.get('op') || '';
  // Shown inside the uWallet window (uWallet navigates its own window here and back).
  const compact = params.get('w') === '1' && !!session;
  const EXT_RE = /^[a-p]{32}$/;

  // The extension id: from uWallet's link, else remembered from an earlier visit.
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  };
  let ext = params.get('ext') || new URLSearchParams(location.search).get('ext') || '';
  if (EXT_RE.test(ext)) store.set('uwallet_ext', ext);
  else ext = store.get('uwallet_ext') || '';

  // ---------- helpers ----------
  const svg = (d) => `<svg viewBox="0 0 24 24">${d}</svg>`;
  const IC = {
    check: svg('<path d="M20 6 9 17l-5-5"/>'),
    key: svg('<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/>'),
    pen: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>'),
    lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
    alert: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/>'),
    plug: svg('<path d="M9 2v6M15 2v6M7 8h10v4a5 5 0 0 1-10 0zM12 17v5"/>'),
    help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17v.01"/>'),
    bolt: svg('<path d="M13.5 2 4 13.5h6.5L9.5 22 20 9.5h-6.5z"/>'),
    at: svg('<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>'),
    globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
    copy: svg('<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>'),
    down: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
    arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  };
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
  const icon = (name, cls) => h('span', { class: cls, html: IC[name] });
  const short = (npub) => `${npub.slice(0, 12)}…${npub.slice(-6)}`;
  const initialOf = (name) => ((name || 'N').match(/[\p{L}\p{N}]/u) || ['N'])[0].toUpperCase();
  const copyBtn = (value, label) => {
    const b = h('button', { class: 'icon-btn', title: label || 'Copy', 'aria-label': label || 'Copy', html: IC.copy });
    b.onclick = async () => {
      try {
        await navigator.clipboard.writeText(value);
        b.innerHTML = IC.check;
        setTimeout(() => (b.innerHTML = IC.copy), 1400);
      } catch { /* clipboard blocked */ }
    };
    return b;
  };
  const download = (name, text) => {
    const a = h('a', { href: `data:application/json;charset=utf-8,${encodeURIComponent(text)}`, download: name });
    document.body.append(a);
    a.click();
    a.remove();
  };

  const card = $('card');
  const mood = (m) => {
    card.classList.toggle('busy', m === 'busy');
    card.classList.toggle('ok', m === 'ok');
  };
  const panel = (...nodes) => $('panel').replaceChildren(...nodes);
  const box = (kind, iconHtml, title, text, ...rest) =>
    h('div', { class: `box ${kind}` }, h('div', { class: 'box-head' }, h('span', { class: 'box-ic', html: iconHtml }), h('div', { class: 'box-t' }, h('b', {}, title), text ? h('span', {}, text) : null)), ...rest);
  const waitBox = (text) => box('', '<span class="spin"></span>', text, '');
  const nostrLinks = () =>
    h('div', { class: 'links' },
      h('a', { href: 'https://getalby.com/', target: '_blank', rel: 'noreferrer' }, 'Alby'),
      h('a', { href: 'https://chromewebstore.google.com/detail/nos2x/kpgefcfmnafjgpblomihpgmejjdanjjp', target: '_blank', rel: 'noreferrer' }, 'nos2x'),
      h('a', { href: 'https://keys.band/', target: '_blank', rel: 'noreferrer' }, 'Keys.band'));
  const waitForNostr = async (ms = 5000) => {
    for (let i = 0; i < ms / 100 && !window.nostr; i++) await new Promise((r) => setTimeout(r, 100));
    return window.nostr;
  };

  if (session) runSession();
  else runHub();

  // =====================================================================
  // Session mode
  // =====================================================================
  function runSession() {
    const COPY = {
      link: ['Link to Nostr', 'Back up this wallet to your Nostr account, encrypted.'],
      login: ['Log in with Nostr', 'Open your uWallet with your Nostr key.'],
      unlink: ['Unlink from Nostr', 'Remove this wallet’s backup from your Nostr account.'],
      address: ['Your Lightning address', 'Publish an address that belongs to your Nostr key.'],
      'address-delete': ['Delete your address', 'Remove your Lightning address from Nostr.'],
    };
    const PLAN = {
      link: [['connect', 'Connect your Nostr key'], ['sign', 'Encrypt your backup'], ['save', 'Save it to your relays']],
      login: [['connect', 'Connect your Nostr key'], ['find', 'Find your wallet'], ['open', 'Unlock it']],
      unlink: [['connect', 'Connect your Nostr key'], ['sign', 'Sign the removal'], ['save', 'Update your relays']],
      address: [['connect', 'Connect your Nostr key'], ['prepare', 'Prepare your address'], ['sign', 'Approve two signatures'], ['upload', 'Store it on several servers'], ['publish', 'Publish it'], ['verify', 'Check it works']],
      'address-delete': [['connect', 'Connect your Nostr key'], ['find', 'Find your address'], ['sign', 'Approve two signatures'], ['remove', 'Remove it from your relays'], ['files', 'Delete the files']],
    };

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
        const verb = tags(e, 't')[0] === 'delete' ? 'delete' : 'upload';
        return [verb === 'delete' ? 'Allow deleting the files' : 'Allow the upload', `${n} small file${n === 1 ? '' : 's'} on ${servers.length || 'any'} server${servers.length === 1 ? '' : 's'}${exp ? `, until ${clock(exp)}` : ''}.`, [
          [`Only these exact ${n === 1 ? 'file' : 'files'}, matched by fingerprint.`],
          [servers.length ? `Servers: ${servers.join(', ')}` : 'Any Blossom server.'],
          [`Kind ${k} · Blossom ${verb} permission`, 1],
        ]];
      }
      if (k === 35128 || k === 15128) {
        const paths = (e.tags || []).filter((t) => t[0] === 'path').map((t) => t[1]);
        const name = (paths.find((p) => /^\/\.well-known\/lnurlp\/[^/]+$/.test(p)) || '').split('/')[3];
        return ['Sign your address', name ? `Publishes ${name}@… pointing to your uWallet.` : 'Publishes your site.', [
          [`Files: ${paths.join(', ')}`],
          [`Stored on ${tags(e, 'server').length} servers. Publishing again replaces it.`],
          [`Kind ${k} · Nostr site “${tags(e, 'd')[0] || 'root'}”`, 1],
        ]];
      }
      if (k === 5) {
        const what = tags(e, 'a')[0] || '';
        return ['Sign the deletion', what.startsWith('35128:') ? 'Asks your relays to remove your Lightning address site.' : 'Asks your relays to remove an event.', [[`Removes: ${what || tags(e, 'e').join(', ')}`], [`Kind ${k} · deletion request`, 1]]];
      }
      return [`Sign a Nostr event (kind ${k})`, String(e.content || '').slice(0, 120), []];
    };
    const more = (items) => (items.length ? h('details', { class: 'more' }, h('summary', {}, 'What you’re signing'), h('ul', {}, items.map(([t, code]) => h('li', { class: code ? 'code' : undefined }, t)))) : null);

    // ---------- setup ----------
    if (!EXT_RE.test(ext) || !/^[A-Za-z0-9_-]{16,64}$/.test(session) || !/^[a-z-]{1,24}$/.test(op)) {
      $('title').textContent = 'Open this from uWallet';
      $('lead').textContent = 'uWallet opens this page when you use Nostr in the wallet.';
      return;
    }
    const [title, lead] = COPY[op] || ['Continue with Nostr', 'uWallet needs your Nostr extension for this.'];
    if (compact) {
      document.body.classList.add('compact');
      $('bar').hidden = false;
      $('bar-title').textContent = title;
      $('back').onclick = goBack;
    }
    $('title').textContent = title;
    $('lead').textContent = lead;
    document.title = `${title} · uWallet`;
    for (const [k, l] of PLAN[op] || []) addStep(k, l);

    const showWho = (w) => {
      if (!w || typeof w.npub !== 'string') return;
      const name = typeof w.name === 'string' && w.name.trim() ? w.name.trim().slice(0, 60) : 'Nostr account';
      $('who').hidden = false;
      $('who-name').textContent = name;
      $('who-npub').textContent = short(w.npub);
      $('who-av').textContent = initialOf(name);
      $('key-node').textContent = initialOf(name);
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
        panel(box('', IC.help, String(q.text || 'Continue?'), Array.isArray(q.points) ? q.points.map(String).join(' ') : '', h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => done(false) }, String(q.no || 'Cancel')), yes)));
        yes.focus();
      });

    const approveBox = (m) => {
      if (m.method === 'getPublicKey') return box('approve', IC.key, 'Share your public key', 'Approve in your Nostr extension. Your public key is already public.');
      if (m.method === 'nip44.decrypt') return box('approve', IC.lock, 'Unlock your wallet backup', 'Approve in your Nostr extension. It decrypts the backup for uWallet.');
      const [t, s, items] = describe(m.params && m.params.event);
      return box('approve', IC.pen, t, `${s} Approve in your Nostr extension.`.trim(), more(items));
    };

    let port = null;
    let finished = false;
    // Back to uWallet: uWallet cancels this session and returns its window to the wallet.
    // (A web page can't open uWallet's pages itself, so it asks uWallet to.)
    function goBack() {
      try {
        const p = port || chrome.runtime.connect(ext, { name: 'uwallet-companion' });
        p.postMessage({ back: session });
      } catch { /* uWallet unreachable */ }
      setTimeout(() => history.back(), 800);
    }
    const backBtn = () => (compact ? h('button', { class: 'btn', onclick: goBack }, 'Back to uWallet') : null);
    const fail = (text, retry) => {
      mood('');
      failStep();
      panel(box('bad', IC.alert, 'That didn’t work', text, h('div', { class: 'row' }, backBtn(), retry ? h('button', { class: 'btn primary', onclick: retry }, 'Try again') : null)));
    };

    const connect = () => {
      resetSteps();
      mood('busy');
      panel(waitBox('Connecting to uWallet…'));
      try {
        port = chrome.runtime.connect(ext, { name: 'uwallet-companion' });
      } catch {
        return fail(compact ? 'Couldn’t reach uWallet. Go back and start again.' : 'Couldn’t reach uWallet. Make sure the extension is installed and turned on, then start again from uWallet.');
      }
      const p = port;
      const ping = setInterval(() => p.postMessage({ ping: 1 }), 15000);
      p.onDisconnect.addListener(() => {
        clearInterval(ping);
        if (port !== p) return;
        port = null;
        if (!finished) fail(compact ? 'uWallet ended this. Go back and start again.' : 'uWallet ended the session. Start again from uWallet.');
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
          return panel(box('done', IC.check, String(m.done), 'Returning to uWallet…'));
        }
        if (m.fail)
          return fail(String(m.fail), () => {
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

    mood('busy');
    panel(waitBox('Looking for your Nostr extension…'));
    waitForNostr().then((n) => {
      if (n) return connect();
      mood('');
      panel(box('bad', IC.plug, 'No Nostr extension found', 'Install one, then reload this page.', nostrLinks(), h('div', { class: 'row' }, backBtn(), h('button', { class: 'btn primary', onclick: () => location.reload() }, 'Reload'))));
    });
  }

  // =====================================================================
  // Dashboard mode
  // =====================================================================
  function runHub() {
    card.hidden = true;
    const hub = $('hub');
    hub.hidden = false;
    document.title = 'uWallet Connect';

    let state = null;
    let port = null;
    let nextId = 1;
    const waiting = new Map();
    let hasNostr = !!window.nostr;
    const wizard = { domain: '', how: 'cloudflare', result: null, busy: false, files: null };

    const ask = (method, p) =>
      new Promise((resolve, reject) => {
        if (!port) return reject(new Error('Not connected to uWallet.'));
        const id = nextId++;
        waiting.set(id, { resolve, reject });
        port.postMessage({ id, method, params: p || {} });
      });
    const open = (screen) => ask('open', { screen }).catch(() => {});

    const head = (t, s) => h('div', { class: 'hub-head' }, h('h1', {}, t), s ? h('p', {}, s) : null);
    const tile = (cls, ic, icCls, title, subtitle, pill, ...body) =>
      h('div', { class: `tile ${cls || ''}` }, h('div', { class: 'tile-head' }, icon(ic, `tile-ic ${icCls || ''}`), h('div', { class: 'tile-t' }, h('b', {}, title), subtitle ? h('small', {}, subtitle) : null), pill), ...body);
    const pill = (text, kind) => h('span', { class: `pill ${kind || ''}` }, text);
    const btn = (text, onclick, primary, ic) => h('button', { class: `btn sm ${primary ? 'primary' : ''}`, onclick }, ic ? icon(ic) : null, text);

    const message = (t, s, ...rest) => hub.replaceChildren(head(t, s), ...rest);

    // ---------- connect ----------
    if (!EXT_RE.test(ext) || typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.connect !== 'function') {
      message('uWallet Connect', 'Your wallet and Nostr, on one page.',
        h('div', { class: 'tile' }, h('div', { class: 'tile-head' }, icon('bolt', 'tile-ic app'), h('div', { class: 'tile-t' }, h('b', {}, 'Open this page from uWallet'), h('small', {}, 'In uWallet: Settings → uWallet Connect'))),
          h('p', {}, 'This page talks to the uWallet extension in this browser. Open it from uWallet once, and it will remember the way.')));
      return;
    }

    let retries = 0;
    const connect = () => {
      try {
        port = chrome.runtime.connect(ext, { name: 'uwallet-hub' });
      } catch {
        return notInstalled();
      }
      const p = port;
      const ping = setInterval(() => p.postMessage({ ping: 1 }), 20000);
      p.onDisconnect.addListener(() => {
        clearInterval(ping);
        if (port !== p) return;
        port = null;
        for (const w of waiting.values()) w.reject(new Error('uWallet disconnected.'));
        waiting.clear();
        // A sleeping background reconnects; a missing extension doesn't.
        if (state && retries++ < 5) setTimeout(connect, 800);
        else notInstalled();
      });
      p.onMessage.addListener((m) => {
        if (!m || typeof m !== 'object' || port !== p) return;
        if (m.state) {
          state = m.state;
          retries = 0;
          return render();
        }
        const w = waiting.get(m.id);
        if (!w) return;
        waiting.delete(m.id);
        if (m.error !== undefined) w.reject(new Error(m.error));
        else w.resolve(m.result);
      });
      ask('state').then((s) => {
        state = s;
        render();
      }, () => {});
    };
    const notInstalled = () =>
      message('uWallet Connect', 'Your wallet and Nostr, on one page.',
        h('div', { class: 'tile' }, h('div', { class: 'tile-head' }, icon('plug', 'tile-ic app'), h('div', { class: 'tile-t' }, h('b', {}, 'Can’t reach uWallet'), h('small', {}, 'Is the extension installed and turned on?'))),
          h('p', {}, 'Open this page from uWallet (Settings → uWallet Connect) in the browser where uWallet is installed.'),
          h('div', { class: 'row' }, btn('Try again', () => location.reload(), true))));

    message('uWallet Connect', 'Connecting to uWallet…');
    connect();
    waitForNostr(3000).then((n) => {
      hasNostr = !!n;
      if (state) render();
    });

    // ---------- render ----------
    function render() {
      const s = state;
      const tiles = h('div', { class: 'tiles' }, walletTile(s), accountTile(s), addressTile(s), s.address ? domainTile(s) : null);
      hub.replaceChildren(head('Your wallet & Nostr', 'Everything uWallet does with Nostr, in one place.'), tiles);
    }

    function walletTile(s) {
      const status = s.wallet === 'unlocked' ? pill('Ready', 'ok') : s.wallet === 'locked' ? pill('Locked', 'warn') : pill('Not set up');
      return tile('', 'bolt', 'app', 'uWallet', `Version ${s.version}`, status,
        s.lightningAddress ? h('div', { class: 'addr' }, h('span', { class: 'mono' }, s.lightningAddress), copyBtn(s.lightningAddress, 'Copy Lightning address')) : h('p', {}, s.wallet === 'none' ? 'Create a wallet, or log in with Nostr if you already use uWallet.' : 'No Lightning address yet.'),
        h('div', { class: 'row' }, btn(s.wallet === 'none' ? 'Set up uWallet' : s.wallet === 'locked' ? 'Unlock' : 'Open wallet', () => open('wallet'), s.wallet === 'locked')));
    }

    function accountTile(s) {
      const a = s.account;
      if (a)
        return tile('', 'key', 'violet', a.name || 'Nostr account', short(a.npub), pill('Linked', 'ok'),
          h('p', {}, `Your encrypted wallet backup is on ${a.relays} relay${a.relays === 1 ? '' : 's'}. On a new browser, choose “Log in with Nostr”.`),
          h('div', { class: 'row' }, btn('Manage', () => open('nostr-account'))));
      const none = s.wallet === 'none';
      return tile('', 'key', 'violet', 'Nostr account', hasNostr ? 'Nostr extension found' : 'No Nostr extension in this browser', pill('Not linked'),
        h('p', {}, none ? 'Already use uWallet with Nostr? Log in with your Nostr key.' : 'Back up this wallet to Nostr and log in anywhere with your key.'),
        hasNostr ? null : nostrLinks(),
        h('div', { class: 'row' }, btn(none ? 'Log in with Nostr' : 'Link with Nostr', () => open(none ? 'wallet' : 'nostr-account'), true)));
    }

    function addressTile(s) {
      const a = s.address;
      if (a) {
        const live = !!a.verifiedAt;
        return tile('wide', 'at', 'green', 'Lightning address on Nostr', 'Belongs to your Nostr key', live ? pill('Live', 'ok') : pill('Waiting', 'warn'),
          h('div', { class: 'addr' }, h('span', { class: 'mono' }, a.address), copyBtn(a.address, 'Copy address')),
          a.domain && a.domainVerifiedAt ? h('div', { class: 'addr' }, h('span', { class: 'mono' }, `${a.name}@${a.domain}`), copyBtn(`${a.name}@${a.domain}`, 'Copy address')) : null,
          h('div', { class: 'meta' }, h('span', {}, `Stored on ${a.servers.length} servers`), h('span', {}, `Published ${new Date(a.publishedAt).toLocaleDateString()}`)),
          h('div', { class: 'row' }, btn('Manage or delete', () => open('nostr-address'))));
      }
      const can = !!s.lightningAddress;
      return tile('wide', 'at', 'green', 'Lightning address on Nostr', 'No sign-up: it belongs to your Nostr key', pill('Not set up'),
        h('p', {}, can ? 'Publish a Lightning address owned by your Nostr key, stored on several servers. Payments arrive in this wallet.' : s.wallet === 'none' ? 'Once your wallet is set up, publish a Lightning address owned by your Nostr key.' : 'Get a Lightning address in uWallet first, then publish it on Nostr.'),
        s.wallet === 'none' ? null : h('div', { class: 'row' }, can ? btn('Create my address', () => open('nostr-address'), true) : btn('Get a Lightning address', () => open('receive'))));
    }

    // ---------- custom domain ----------
    function domainTile(s) {
      const a = s.address;
      const done = a.domain && a.domainVerifiedAt;
      const body = h('div', { class: 'howto-wrap' });
      const t = tile('wide', 'globe', '', 'Use your own domain', done ? `${a.name}@${a.domain} works` : `Get a short address like ${a.name}@yourname.com`, done ? pill('Working', 'ok') : null, body);
      if (!wizard.domain && a.domain) wizard.domain = a.domain;
      drawWizard(body, a);
      return t;
    }

    function drawWizard(body, a) {
      const d = wizard.domain || 'yourname.com';
      const target = `https://${a.host}/.well-known`;
      const row = (k, v) => h('div', { class: 'copy' }, h('span', { class: 'k' }, k), h('code', {}, v), copyBtn(v));
      const input = h('input', { class: 'input', placeholder: 'yourname.com', value: wizard.domain, autocapitalize: 'off', spellcheck: 'false', inputmode: 'url' });
      input.addEventListener('change', () => {
        wizard.domain = input.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        wizard.result = null;
        drawWizard(body, a);
      });
      const seg = h('div', { class: 'seg', role: 'tablist' },
        [['cloudflare', 'Cloudflare'], ['netlify', 'Netlify · Vercel'], ['files', 'Any host']].map(([k, l]) =>
          h('button', { class: wizard.how === k ? 'on' : '', role: 'tab', 'aria-selected': String(wizard.how === k), onclick: () => ((wizard.how = k), drawWizard(body, a)) }, l)));

      let steps;
      if (wizard.how === 'cloudflare')
        steps = [
          h('li', {}, h('div', {}, h('span', {}, h('b', {}, `${d}`), ' uses Cloudflare (the free plan works). No website needed.'))),
          h('li', {}, h('div', {}, h('span', {}, 'No website on it yet? In ', h('b', {}, 'DNS → Records'), ' add this record with the proxy ', h('b', {}, 'on'), ':'), row('Type', 'AAAA'), row('Name', '@'), row('IPv6', '100::'))),
          h('li', {}, h('div', {}, h('span', {}, 'In ', h('b', {}, 'Rules → Redirect Rules'), ', create a rule with ', h('b', {}, 'Wildcard pattern'), ':'), row('From', `https://${d}/.well-known/*`), row('To', `${target}/\${1}`), row('Status', '302'))),
        ];
      else if (wizard.how === 'netlify')
        steps = [
          h('li', {}, h('div', {}, h('span', {}, h('b', {}, 'Netlify:'), ' add a file named ', h('code', {}, '_redirects'), ' to your site with:'), row('File', `/.well-known/*  ${target}/:splat  302`))),
          h('li', {}, h('div', {}, h('span', {}, h('b', {}, 'Vercel:'), ' or add this to ', h('code', {}, 'vercel.json'), ':'), row('JSON', JSON.stringify({ redirects: [{ source: '/.well-known/:path*', destination: `${target}/:path*`, permanent: false }] })))),
          h('li', {}, h('div', {}, h('span', {}, 'Deploy. Your address now forwards to your Nostr copy, so updates in uWallet apply automatically.'))),
        ];
      else
        steps = [
          h('li', {}, h('div', {}, h('span', {}, 'Download your two files:'), h('div', { class: 'row' },
            btn(a.name, () => getFiles().then((f) => download(f.name, f.card), filesFailed), false, 'down'),
            btn('nostr.json', () => getFiles().then((f) => download('nostr.json', f.nip05), filesFailed), false, 'down')))),
          h('li', {}, h('div', {}, h('span', {}, 'Upload them to your site at:'), row('File 1', `/.well-known/lnurlp/${a.name}`), row('File 2', '/.well-known/nostr.json'))),
          h('li', {}, h('div', {}, h('span', {}, 'Let wallets read them from other sites: send this header for ', h('code', {}, '/.well-known/*'), '. GitHub Pages already does; add an empty ', h('code', {}, '.nojekyll'), ' file there.'), row('Header', 'Access-Control-Allow-Origin: *'))),
          h('li', {}, h('div', {}, h('span', { class: 'note' }, 'If you change your address in uWallet later, download and upload the files again.'))),
        ];

      const filesFailed = (e) => {
        wizard.result = { ok: false, text: e.message };
        drawWizard(body, a);
      };
      const valid = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(wizard.domain);
      const check = h('button', { class: 'btn primary', disabled: !valid || wizard.busy }, wizard.busy ? h('span', { class: 'spin' }) : null, valid ? `Check ${a.name}@${wizard.domain}` : 'Enter your domain to check');
      check.onclick = async () => {
        wizard.busy = true;
        wizard.result = null;
        drawWizard(body, a);
        try {
          const r = await ask('checkDomain', { domain: wizard.domain });
          wizard.result = r.ok ? { ok: true, text: `${a.name}@${wizard.domain} works. Share it anywhere.` } : { ok: false, text: `Not yet: https://${wizard.domain}/.well-known/lnurlp/${a.name} doesn’t show your address. Changes can take a few minutes; check the steps and try again.` };
        } catch (e) {
          wizard.result = { ok: false, text: e.message };
        }
        wizard.busy = false;
        drawWizard(body, a);
      };

      body.replaceChildren(...[
        h('label', { class: 'field' }, 'Your domain', input),
        seg,
        h('ol', { class: 'howto' }, steps),
        wizard.result ? h('div', { class: `result ${wizard.result.ok ? 'ok' : 'bad'}` }, wizard.result.text) : null,
        h('div', { class: 'row' }, check),
      ].filter(Boolean));
      body.style.display = 'flex';
      body.style.flexDirection = 'column';
      body.style.gap = '14px';
    }

    const getFiles = async () => (wizard.files ??= await ask('files'));
  }
})();
