// uWallet ⇄ Nostr extension bridge.
//
// uWallet opens this page as …/#ext=<extension id>&s=<session>&op=<link|login|unlink|address>.
// The page connects to uWallet (externally_connectable) and answers its requests by
// calling the NIP-07 provider (window.nostr) that the user's Nostr extension adds.
// It holds no logic of its own and never contacts a server. Before each signature it
// describes what is being signed from the event itself, not from what uWallet says.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.hash.slice(1));
  const ext = params.get('ext') || '';
  const session = params.get('s') || '';
  const op = params.get('op') || '';

  const COPY = {
    link: ['Link uWallet to Nostr', 'Back up this wallet to your Nostr account, encrypted so only your Nostr key can open it. Next time, log in with Nostr instead of typing 12 words.'],
    login: ['Log in with Nostr', 'uWallet will look for the wallet backup on your Nostr account and open it with your Nostr extension.'],
    unlink: ['Unlink from Nostr', 'Remove this wallet’s backup from your Nostr account. Keep your 12 words safe: they are then the only way to restore it.'],
    address: ['Publish your Lightning address', 'Create a Lightning address that belongs to your Nostr account. It’s stored on several independent servers, and payments go straight to your uWallet.'],
  };
  // What each operation will ask for, in order. Keys match incoming requests.
  const PLAN = {
    link: [['pubkey', 'Read your public key'], ['sign:30078', 'Sign your encrypted wallet backup']],
    login: [['pubkey', 'Read your public key'], ['decrypt', 'Open your wallet backup (if one exists)']],
    unlink: [['pubkey', 'Read your public key'], ['sign:30078', 'Sign an empty backup that replaces the old one']],
    address: [['pubkey', 'Read your public key'], ['confirm', 'Your OK on this page'], ['sign:24242', 'Sign permission to upload two small files'], ['sign:35128', 'Sign your address site']],
  };

  const status = (t, kind) => {
    $('status').textContent = t || '';
    $('status').className = `status ${kind || ''}`;
  };
  const el = (tag, text, cls) => {
    const e = document.createElement(tag);
    if (text) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  };

  // ---------- plan ----------
  const planItems = [];
  const showPlan = () => {
    const ol = $('plan');
    for (const [key, label] of PLAN[op] || []) {
      const li = el('li', label);
      ol.appendChild(li);
      planItems.push({ key, li });
    }
    $('plan-box').hidden = !planItems.length;
  };
  const markActive = (key, label) => {
    let item = planItems.find((p) => p.key === key && !p.li.classList.contains('done'));
    if (!item) {
      item = { key, li: el('li', label) };
      $('plan').appendChild(item.li);
      planItems.push(item);
      $('plan-box').hidden = false;
    }
    for (const p of planItems) {
      if (p === item) break;
      p.li.classList.remove('active');
      p.li.classList.add('done');
    }
    item.li.classList.add('active');
  };
  const finishPlan = () => planItems.forEach((p) => (p.li.classList.remove('active'), p.li.classList.add('done')));

  // ---------- describe what is being signed (from the event itself) ----------
  const tag = (e, name) => (e.tags || []).filter((t) => t[0] === name).map((t) => t[1]);
  const when = (unix) => new Date(Number(unix) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const describe = (e) => {
    if (!e || typeof e !== 'object') return ['a Nostr event', []];
    const k = e.kind;
    if (k === 30078 && tag(e, 'd')[0] === 'uwallet-backup') {
      if (tag(e, 'deleted').length || !e.content) return ['an empty wallet backup', ['Replaces your uWallet backup on your relays, so it can no longer be restored with Nostr.', `Nostr event kind ${k}`]];
      return ['your encrypted wallet backup', ['The 12 words are encrypted to your Nostr key; only your Nostr extension can open them.', 'Saved on your relays as an app setting.', `Nostr event kind ${k}`]];
    }
    if (k === 24242) {
      const servers = tag(e, 'server');
      const files = tag(e, 'x').length;
      const exp = tag(e, 'expiration')[0];
      return ['permission to upload files', [
        `Lets uWallet upload ${files} file${files === 1 ? '' : 's'}, identified by exact contents, and nothing else.`,
        servers.length ? `Only to: ${servers.join(', ')}` : 'To any Blossom server.',
        exp ? `Expires at ${when(exp)} (in about ${Math.max(1, Math.round((Number(exp) - Date.now() / 1000) / 60))} minutes).` : 'Has no expiry.',
        `Nostr event kind ${k} (Blossom)`,
      ]];
    }
    if (k === 35128 || k === 15128) {
      const paths = (e.tags || []).filter((t) => t[0] === 'path').map((t) => t[1]);
      return ['your address site', [
        `A public site named “${tag(e, 'd')[0] || 'root'}” with ${paths.length} entries: ${paths.join(', ')}`,
        `Files stored on ${tag(e, 'server').length} Blossom servers.`,
        'Published to your relays. Publishing again later replaces it.',
        `Nostr event kind ${k} (nsite)`,
      ]];
    }
    return [`Nostr event kind ${k}`, [String(e.content || '').slice(0, 140)].filter(Boolean)];
  };
  const showDetail = (head, points) => {
    $('detail').hidden = false;
    $('detail-head').textContent = head;
    const ul = $('detail-list');
    ul.textContent = '';
    for (const p of points) ul.appendChild(el('li', p));
  };
  const hideDetail = () => ($('detail').hidden = true);

  if (!/^[a-p]{32}$/.test(ext) || !/^[A-Za-z0-9_-]{16,64}$/.test(session) || !/^[a-z-]{1,24}$/.test(op)) {
    $('title').textContent = 'Open this from uWallet';
    $('lead').textContent = 'This page is opened by the uWallet extension when you link, log in or publish an address with Nostr.';
    $('trust').hidden = true;
    return;
  }
  // A newer uWallet may ask for something this page doesn't name yet. It still works:
  // every request is listed and described as it arrives.
  if (!COPY[op]) COPY[op] = ['Continue with Nostr', 'uWallet needs your Nostr extension for this. Each request is shown below before you approve it.'];
  $('title').textContent = COPY[op][0];
  $('lead').textContent = COPY[op][1];
  showPlan();

  // Nostr extensions add window.nostr shortly after the page loads.
  const waitForNostr = async () => {
    for (let i = 0; i < 30 && !window.nostr; i++) await new Promise((r) => setTimeout(r, 100));
    return window.nostr;
  };

  const call = async (method, p) => {
    const n = window.nostr;
    if (method === 'getPublicKey') return n.getPublicKey();
    if (method === 'signEvent') return n.signEvent(p.event);
    if (method === 'nip44.decrypt') {
      if (!n.nip44 || typeof n.nip44.decrypt !== 'function') throw new Error('Your Nostr extension doesn’t support NIP-44 encryption. Update it, or use one that does (Alby, nos2x, Keys.band…).');
      return n.nip44.decrypt(p.pubkey, p.ciphertext);
    }
    throw new Error('Unknown request');
  };

  const ask = (q) =>
    new Promise((resolve) => {
      $('ask').hidden = false;
      $('ask-text').textContent = String(q.text || '');
      const ul = $('ask-points');
      ul.textContent = '';
      for (const p of Array.isArray(q.points) ? q.points : []) ul.appendChild(el('li', String(p)));
      $('ask-yes').textContent = String(q.yes || 'Yes');
      $('ask-no').textContent = String(q.no || 'Cancel');
      const done = (v) => {
        $('ask').hidden = true;
        resolve(v);
      };
      $('ask-yes').onclick = () => done(true);
      $('ask-no').onclick = () => done(false);
    });

  const keyOf = (m) => (m.method === 'getPublicKey' ? 'pubkey' : m.method === 'nip44.decrypt' ? 'decrypt' : m.method === 'confirm' ? 'confirm' : `sign:${m.params && m.params.event && m.params.event.kind}`);

  const start = () => {
    $('go').hidden = true;
    let port;
    try {
      port = chrome.runtime.connect(ext, { name: 'uwallet-companion' });
    } catch {
      status('Couldn’t reach uWallet. Is the extension installed and up to date?', 'bad');
      return;
    }
    status('Connecting to uWallet…');
    // Keeps uWallet's background awake while you approve things in your Nostr extension.
    const ping = setInterval(() => port.postMessage({ ping: 1 }), 15000);
    port.onDisconnect.addListener(() => {
      clearInterval(ping);
      if (!$('status').classList.contains('ok') && !$('status').classList.contains('bad')) status('uWallet closed the connection. Start again from uWallet.', 'bad');
    });
    port.onMessage.addListener(async (m) => {
      if (!m || typeof m !== 'object') return;
      if (typeof m.status === 'string') return status(m.status);
      if (m.done) {
        finishPlan();
        hideDetail();
        status(m.done, 'ok');
        $('trust').hidden = true;
        return;
      }
      if (m.fail) {
        hideDetail();
        return status(m.fail, 'bad');
      }
      if (typeof m.id !== 'number') return;
      const key = keyOf(m);
      if (m.method === 'confirm') {
        markActive(key, 'Your OK on this page');
        hideDetail();
        status('');
        return port.postMessage({ id: m.id, result: await ask(m.params || {}) });
      }
      if (m.method === 'signEvent') {
        const [head, points] = describe(m.params && m.params.event);
        markActive(key, `Sign ${head}`);
        showDetail(`You’re signing ${head}`, points);
      } else {
        markActive(key, m.method === 'getPublicKey' ? 'Read your public key' : m.method === 'nip44.decrypt' ? 'Open your wallet backup' : m.method);
        hideDetail();
      }
      status('Approve the request in your Nostr extension…');
      try {
        const result = await call(m.method, m.params || {});
        status('');
        port.postMessage({ id: m.id, result });
      } catch (e) {
        port.postMessage({ id: m.id, error: (e && e.message) || String(e) || 'Rejected' });
      }
    });
    port.postMessage({ hello: session });
  };

  waitForNostr().then((n) => {
    if (!n) {
      status('No Nostr extension found in this browser. Install one (for example Alby, nos2x or Keys.band), reload this page, and try again.', 'bad');
      return;
    }
    $('go').hidden = false;
    $('go').onclick = start;
  });
})();
