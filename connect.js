// uWallet ⇄ Nostr extension bridge.
//
// uWallet opens this page as …/#ext=<extension id>&s=<session>&op=<link|login|unlink>.
// The page connects to uWallet (externally_connectable) and answers its requests by
// calling the NIP-07 provider (window.nostr) that the user's Nostr extension adds.
// It holds no logic of its own and never contacts a server.
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
  };
  const WHAT = {
    getPublicKey: 'Read your public key',
    signEvent: 'Sign your encrypted wallet backup',
    'nip44.decrypt': 'Open your wallet backup',
  };

  const status = (t, kind) => {
    $('status').textContent = t || '';
    $('status').className = `status ${kind || ''}`;
  };
  const step = (t) => {
    const ul = $('steps');
    ul.hidden = false;
    const prev = ul.lastElementChild;
    if (prev) prev.classList.add('done');
    const li = document.createElement('li');
    li.textContent = t;
    ul.appendChild(li);
  };

  if (!/^[a-p]{32}$/.test(ext) || !/^[A-Za-z0-9_-]{16,64}$/.test(session) || !COPY[op]) {
    $('title').textContent = 'Open this from uWallet';
    $('lead').textContent = 'This page is opened by the uWallet extension when you link or log in with Nostr.';
    return;
  }
  $('title').textContent = COPY[op][0];
  $('lead').textContent = COPY[op][1];

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
      $('ask-text').textContent = q.text;
      $('ask-yes').textContent = q.yes;
      $('ask-no').textContent = q.no;
      const done = (v) => {
        $('ask').hidden = true;
        resolve(v);
      };
      $('ask-yes').onclick = () => done(true);
      $('ask-no').onclick = () => done(false);
    });

  const start = () => {
    $('go').hidden = true;
    let port;
    try {
      port = chrome.runtime.connect(ext, { name: 'uwallet-companion' });
    } catch {
      status('Couldn’t reach uWallet. Is the extension installed and up to date?', 'bad');
      return;
    }
    // Keeps uWallet's background awake while you approve things in your Nostr extension.
    const ping = setInterval(() => port.postMessage({ ping: 1 }), 15000);
    port.onDisconnect.addListener(() => {
      clearInterval(ping);
      if (!$('status').classList.contains('ok') && !$('status').classList.contains('bad')) status('uWallet closed the connection. Start again from uWallet.', 'bad');
    });
    port.onMessage.addListener(async (m) => {
      if (!m || typeof m !== 'object') return;
      if (m.status) return status(m.status);
      if (m.done) {
        if ($('steps').lastElementChild) $('steps').lastElementChild.classList.add('done');
        status(m.done, 'ok');
        $('fine').hidden = true;
        return;
      }
      if (m.fail) return status(m.fail, 'bad');
      if (typeof m.id !== 'number') return;
      if (m.method === 'confirm') return port.postMessage({ id: m.id, result: await ask(m.params) });
      step(WHAT[m.method] || m.method);
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
