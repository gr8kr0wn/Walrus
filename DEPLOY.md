# WalrusMint — Deployment Guide

End-to-end steps to go from source to a live, mainnet-ready WalrusMint deployment.

---

## 1. Install the Sui CLI

```bash
# macOS / Linux (via Homebrew)
brew install sui

# Or install from source
cargo install --locked --git https://github.com/MystenLabs/sui.git --branch testnet sui

# Verify
sui --version
```

Configure the CLI to use testnet:

```bash
sui client new-env --alias testnet --rpc https://fullnode.testnet.sui.io:443
sui client switch --env testnet
```

Make sure your active address has testnet SUI for gas:

```bash
sui client faucet          # request testnet tokens
sui client gas             # confirm balance
```

---

## 2. Deploy the Move Contract

```bash
# From the repo root
sui client publish contract/ --gas-budget 200000000
```

The output will include a section like:

```
----- Transaction Effects ----
Created Objects:
  - ID: 0xPACKAGE_ID  ...  (package)
  - ID: 0xREGISTRY_ID ...  (shared MarketplaceRegistry)
```

Copy both IDs — you will need them in the next step.

---

## 3. Configure the Backend

```bash
cd backend
cp .env.example .env
```

Edit `.env` and fill in the real values:

```
PORT=3001
SUI_NETWORK=testnet
SUI_RPC_URL=https://fullnode.testnet.sui.io:443
CONTRACT_PACKAGE_ID=0xPACKAGE_ID        # from step 2
MARKETPLACE_REGISTRY_ID=0xREGISTRY_ID  # from step 2
WALRUS_AGGREGATOR_URL=https://aggregator.walrus-testnet.walrus.space/v1
ALLOWED_ORIGINS=http://localhost:4173,https://your-frontend.vercel.app
```

---

## 4. Install Dependencies and Run Tests

```bash
cd backend
npm install
npm test
```

Expected output (without a real deployed contract the tx-building tests return 503, which is expected):

```
WalrusMint Backend Tests

  ✓  GET /health returns 200 with status:ok
  ✓  GET /nfts returns 200 with array
  ✓  GET /nfts/owner/:address returns 200 with array
  ✓  GET /activity returns 200 with array
  ✓  GET /rankings returns 200 with array
  ✓  POST /mint returns 503 (contract not deployed — expected)
  ✓  POST /mint with missing fields returns 400
  ✓  POST /marketplace/buy returns 503 (contract not deployed — expected)
  ✓  POST /marketplace/buy with missing fields returns 400
  ✓  POST /marketplace/offers returns 503 (contract not deployed — expected)
  ✓  Unknown routes return 404

11 passed, 0 failed
```

Once `CONTRACT_PACKAGE_ID` is set to a real deployed package, the 503 tests will return 200 with `{ transactionBytes: "..." }` instead.

---

## 5. Deploy Backend to Railway

1. Push the repo to GitHub (or connect Railway to your existing repo).

2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**.

3. Select the repo. Railway will detect `backend/railway.json` automatically.

4. In the Railway project settings, set the **Root Directory** to `backend`.

5. Add environment variables (same as your `.env` file) under **Variables**.

6. Railway will build and deploy. Copy the generated URL (e.g. `https://walrusmint-backend.up.railway.app`).

7. Add the Railway URL to `ALLOWED_ORIGINS` in the Railway environment variables.

---

## 6. Deploy Frontend to Vercel

```bash
# Install Vercel CLI if needed
npm i -g vercel

# From the repo root
vercel
```

Follow the prompts. Vercel will detect the static site (no build step needed — it's plain HTML/JS/CSS).

Alternatively, connect the GitHub repo in the [Vercel dashboard](https://vercel.com/dashboard):
- Framework preset: **Other**
- Root directory: `.` (repo root)
- Build command: *(leave empty)*
- Output directory: `.` (or `src` if you restructure)

---

## 7. Update app.config.js with Real URLs

After both services are deployed, edit `app.config.js`:

```js
window.WALRUSMINT_CONFIG = {
  network: "sui:testnet",
  rpcUrl: "https://fullnode.testnet.sui.io:443",
  walrusPublisherUrl: "https://publisher.walrus-testnet.walrus.space/v1/blobs",
  marketplaceApiUrl: "https://walrusmint-backend.up.railway.app/marketplace",
  mintApiUrl: "https://walrusmint-backend.up.railway.app/mint",
  contractPackageId: "0xPACKAGE_ID",
  collectionObjectId: "0xREGISTRY_ID",
  backendUrl: "https://walrusmint-backend.up.railway.app"
};
```

Commit and push — Vercel will redeploy automatically.

---

## 8. Switch to Mainnet

When you are ready for mainnet:

### 8a. Re-deploy the contract on mainnet

```bash
sui client new-env --alias mainnet --rpc https://fullnode.mainnet.sui.io:443
sui client switch --env mainnet
sui client publish contract/ --gas-budget 200000000
```

### 8b. Update backend `.env` (or Railway variables)

```
SUI_NETWORK=mainnet
SUI_RPC_URL=https://fullnode.mainnet.sui.io:443
CONTRACT_PACKAGE_ID=0xMAINNET_PACKAGE_ID
MARKETPLACE_REGISTRY_ID=0xMAINNET_REGISTRY_ID
WALRUS_AGGREGATOR_URL=https://aggregator.walrus.space/v1
```

### 8c. Update `app.config.js`

```js
window.WALRUSMINT_CONFIG = {
  network: "sui:mainnet",
  rpcUrl: "https://fullnode.mainnet.sui.io:443",
  walrusPublisherUrl: "https://publisher.walrus.space/v1/blobs",
  marketplaceApiUrl: "https://walrusmint-backend.up.railway.app/marketplace",
  mintApiUrl: "https://walrusmint-backend.up.railway.app/mint",
  contractPackageId: "0xMAINNET_PACKAGE_ID",
  collectionObjectId: "0xMAINNET_REGISTRY_ID",
  backendUrl: "https://walrusmint-backend.up.railway.app"
};
```

### 8d. Mainnet Walrus endpoints

| Service    | Testnet URL                                              | Mainnet URL                                    |
|------------|----------------------------------------------------------|------------------------------------------------|
| Publisher  | `https://publisher.walrus-testnet.walrus.space/v1/blobs` | `https://publisher.walrus.space/v1/blobs`      |
| Aggregator | `https://aggregator.walrus-testnet.walrus.space/v1`      | `https://aggregator.walrus.space/v1`           |

---

## Quick Reference

| Command                                  | What it does                          |
|------------------------------------------|---------------------------------------|
| `sui client publish contract/`           | Deploy Move package to current env    |
| `cd backend && npm install && npm test`  | Install deps and run backend tests    |
| `cd backend && npm run dev`              | Start backend with file-watch         |
| `vercel`                                 | Deploy frontend to Vercel             |
