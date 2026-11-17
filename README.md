# uWallet Connect

The companion page that lets the [uWallet](https://chromewebstore.google.com/) browser extension link a wallet to your Nostr account, log in with Nostr, or publish a Lightning address owned by your Nostr key.

uWallet opens this page in a tab. It starts by itself once your Nostr extension is found, shows each step, and closes when done. The page connects back to uWallet (Chrome `externally_connectable`) and passes uWallet's requests to your Nostr extension (NIP-07 `window.nostr`): read your public key, sign the encrypted wallet backup, open (NIP-44 decrypt) the backup, or sign a Blossom upload permission (kind 24242) and a named-site manifest (NIP-5A kind 35128) for the Lightning address.

Before every signature the page lists what is being signed, read from the event itself (kind, servers, files, expiry), not from what uWallet says.

- Your Nostr private key never leaves your Nostr extension.
- The page has no server and no logic of its own. Its Content-Security-Policy is `connect-src 'none'`, so it can't send data anywhere.
- The backup is a NIP-78 (kind 30078, `d=uwallet-backup`) event signed by you, with the recovery phrase NIP-44-encrypted to your own pubkey using a one-time key. uWallet builds and checks it; the page only forwards it.

Static files only: `index.html`, `connect.js`, `style.css`.
