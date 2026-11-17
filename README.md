# uWallet · Nostr bridge

A one-screen page that lets the uWallet browser extension **log in with Nostr** or **link a wallet to your Nostr account** using your Nostr extension (Alby, nos2x, Keys.band…).

Why a web page: Nostr extensions (NIP-07 `window.nostr`) only work on web pages, never on another extension's pages. So uWallet shows this page inside its own window, the page passes uWallet's requests to your Nostr extension, and the window returns to uWallet when done.

What it can ask your Nostr extension for:
- your public key,
- a signature on your encrypted wallet backup (NIP-78, kind 30078, `d=uwallet-backup`; the recovery phrase is NIP-44-encrypted to your own key),
- decrypting that backup when you log in.

- Your Nostr private key never leaves your Nostr extension, and the extension asks before every signature.
- The page has no server and no logic of its own. Its Content-Security-Policy is `connect-src 'none'`, so it can't send data anywhere.

Static files only: `index.html`, `connect.js`, `style.css`.
