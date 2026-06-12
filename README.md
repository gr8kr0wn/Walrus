# WalrusMint

Production-oriented static NFT marketplace dashboard for Walrus-backed NFTs on Sui.

## Run Locally

```bash
npm run serve
```

Open `http://localhost:4173`.

## Configure Production Integrations

Edit `app.config.js` before deploying:

```js
window.WALRUSMINT_CONFIG = {
  network: "sui:mainnet",
  rpcUrl: "https://fullnode.mainnet.sui.io:443",
  walrusPublisherUrl: "https://publisher.walrus-testnet.walrus.space/v1/store",
  marketplaceApiUrl: "https://your-api.example.com/marketplace",
  mintApiUrl: "https://your-api.example.com/mint",
  contractPackageId: "0x...",
  collectionObjectId: "0x..."
};
```

Keep private keys and admin secrets out of this frontend. The `mintApiUrl` and `marketplaceApiUrl` endpoints should live on your backend and validate wallet ownership, collection permissions, pricing, royalties, and rate limits before creating Sui transactions.

## Production Checklist

- Deploy over HTTPS.
- Replace sample NFT data in `src/js/data.js` with contract/indexer data.
- Set a real Walrus publisher endpoint.
- Set backend endpoints for mint, buy, and offer flows.
- Add your Sui package ID and collection object ID.
- Test with Sui Wallet, Ethos, and Suiet on your target network.
- Run `npm run check` before deployment.

## Structure

- `index.html` contains semantic app markup.
- `src/styles/app.css` contains responsive dashboard styling.
- `src/js/main.js` wires UI state and actions.
- `src/js/services/wallet.js` handles Sui wallet detection and connection.
- `src/js/services/walrus.js` uploads media to Walrus.
- `src/js/services/sui.js` calls backend endpoints for minting and marketplace actions.
