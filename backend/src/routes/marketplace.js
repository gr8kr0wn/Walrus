import { Router } from "express";
import { Transaction } from "@mysten/sui/transactions";
import { suiClient, CONTRACT_PACKAGE_ID, MARKETPLACE_ID } from "../sui-client.js";
import { requireFields, requireSuiAddress, requirePositiveInt } from "../middleware/validate.js";
import { isContractDeployed } from "../config.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatMist(mist) {
  return `${(Number(BigInt(mist)) / 1_000_000_000).toFixed(2)} SUI`;
}

// ── Activity router (mounted at /activity) ────────────────────────────────────

export const activityRouter = Router();

activityRouter.get("/", async (req, res, next) => {
  try {
    if (!isContractDeployed()) {
      return res.json([]);
    }

    const [mintEvents, saleEvents] = await Promise.all([
      suiClient.queryEvents({
        query: { MoveEventType: `${CONTRACT_PACKAGE_ID}::nft::NFTMinted` },
        limit: 20,
        order: "descending",
      }),
      suiClient.queryEvents({
        query: { MoveEventType: `${CONTRACT_PACKAGE_ID}::marketplace::NFTSold` },
        limit: 20,
        order: "descending",
      }),
    ]);

    const mintItems = mintEvents.data.map((e) => ({
      verb: "Minted",
      item: e.parsedJson?.name ?? "NFT",
      time: new Date(Number(e.timestampMs)).toISOString(),
      price: formatMist(e.parsedJson?.price ?? 0),
      actor: e.parsedJson?.creator ?? "",
    }));

    const saleItems = saleEvents.data.map((e) => ({
      verb: "Sold",
      item: e.parsedJson?.nft_id ?? "NFT",
      time: new Date(Number(e.timestampMs)).toISOString(),
      price: formatMist(e.parsedJson?.price ?? 0),
      actor: e.parsedJson?.buyer ?? "",
    }));

    const all = [...mintItems, ...saleItems]
      .sort((a, b) => new Date(b.time) - new Date(a.time))
      .slice(0, 20);

    res.json(all);
  } catch (err) {
    next(err);
  }
});

// ── Rankings router (mounted at /rankings) ────────────────────────────────────

export const rankingsRouter = Router();

rankingsRouter.get("/", async (req, res, next) => {
  try {
    if (!isContractDeployed()) {
      return res.json([]);
    }

    const [mintEvents, saleEvents] = await Promise.all([
      suiClient.queryEvents({
        query: { MoveEventType: `${CONTRACT_PACKAGE_ID}::nft::NFTMinted` },
        limit: 100,
        order: "descending",
      }),
      suiClient.queryEvents({
        query: { MoveEventType: `${CONTRACT_PACKAGE_ID}::marketplace::NFTSold` },
        limit: 100,
        order: "descending",
      }),
    ]);

    const collections = {};

    for (const e of mintEvents.data) {
      const col = e.parsedJson?.collection ?? "Unknown";
      if (!collections[col]) collections[col] = { volume: 0n, count: 0, sales: 0 };
      collections[col].count += 1;
    }

    for (const e of saleEvents.data) {
      const price = BigInt(e.parsedJson?.price ?? 0);
      const col = "Unknown";
      if (!collections[col]) collections[col] = { volume: 0n, count: 0, sales: 0 };
      collections[col].volume += price;
      collections[col].sales += 1;
    }

    const rankings = Object.entries(collections).map(([name, stats]) => ({
      collection: name,
      volume: formatMist(stats.volume.toString()),
      minted: stats.count,
      sales: stats.sales,
    }));

    res.json(rankings);
  } catch (err) {
    next(err);
  }
});

// ── Marketplace router (mounted at /marketplace) ──────────────────────────────

const router = Router();

/**
 * POST /marketplace/buy
 */
router.post("/buy", async (req, res, next) => {
  try {
    requireFields(req.body, ["walletAddress", "nftId"]);
    const { walletAddress, nftId, price: priceOverride } = req.body;
    requireSuiAddress(walletAddress, "walletAddress");
    requireSuiAddress(nftId, "nftId");

    if (!isContractDeployed()) {
      return res.status(503).json({
        success: false,
        error: "Contract not deployed. Set CONTRACT_PACKAGE_ID in .env",
      });
    }

    let price;
    if (priceOverride !== undefined) {
      price = BigInt(priceOverride);
    } else {
      const listingObj = await suiClient.getObject({
        id: nftId,
        options: { showContent: true },
      });
      price = BigInt(listingObj.data?.content?.fields?.price ?? 0);
      if (price === 0n) {
        return res.status(400).json({ success: false, error: "Could not determine listing price" });
      }
    }

    const tx = new Transaction();
    tx.setSender(walletAddress);

    const [paymentCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(price)]);

    const args = [tx.object(nftId), paymentCoin];
    if (MARKETPLACE_ID && !MARKETPLACE_ID.startsWith("0x_")) {
      args.unshift(tx.object(MARKETPLACE_ID));
    }

    tx.moveCall({
      target: `${CONTRACT_PACKAGE_ID}::marketplace::buy`,
      arguments: args,
    });

    const bytes = await tx.build({ client: suiClient });
    const transactionBytes = Buffer.from(bytes).toString("base64");

    res.json({ success: true, data: { transactionBytes } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /marketplace/offer and /marketplace/offers (alias)
 */
async function handleOffer(req, res, next) {
  try {
    // Normalise field names
    if (req.body.offerAmount !== undefined && req.body.offerPrice === undefined) {
      req.body.offerPrice = req.body.offerAmount;
    }
    if (req.body.listingId !== undefined && req.body.nftId === undefined) {
      req.body.nftId = req.body.listingId;
    }

    requireFields(req.body, ["walletAddress", "nftId", "offerPrice"]);
    const { walletAddress, nftId, offerPrice, expiryMs = 0 } = req.body;
    requireSuiAddress(walletAddress, "walletAddress");
    requireSuiAddress(nftId, "nftId");
    requirePositiveInt(offerPrice, "offerPrice");

    if (!isContractDeployed()) {
      return res.status(503).json({
        success: false,
        error: "Contract not deployed. Set CONTRACT_PACKAGE_ID in .env",
      });
    }

    const tx = new Transaction();
    tx.setSender(walletAddress);

    const [offerCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(BigInt(offerPrice))]);

    tx.moveCall({
      target: `${CONTRACT_PACKAGE_ID}::marketplace::make_offer`,
      arguments: [
        tx.object(nftId),
        offerCoin,
        tx.pure.u64(BigInt(expiryMs)),
      ],
    });

    const bytes = await tx.build({ client: suiClient });
    const transactionBytes = Buffer.from(bytes).toString("base64");

    res.json({ success: true, data: { transactionBytes } });
  } catch (err) {
    next(err);
  }
}

router.post("/offer", handleOffer);
router.post("/offers", handleOffer);

/**
 * POST /marketplace/list
 */
router.post("/list", async (req, res, next) => {
  try {
    requireFields(req.body, ["walletAddress", "nftId", "price"]);
    const { walletAddress, nftId, price } = req.body;
    requireSuiAddress(walletAddress, "walletAddress");
    requireSuiAddress(nftId, "nftId");
    requirePositiveInt(price, "price");

    if (!isContractDeployed()) {
      return res.status(503).json({
        success: false,
        error: "Contract not deployed. Set CONTRACT_PACKAGE_ID in .env",
      });
    }

    const tx = new Transaction();
    tx.setSender(walletAddress);

    tx.moveCall({
      target: `${CONTRACT_PACKAGE_ID}::marketplace::list_nft`,
      arguments: [
        tx.object(MARKETPLACE_ID),
        tx.object(nftId),
        tx.pure.u64(BigInt(price)),
      ],
    });

    const bytes = await tx.build({ client: suiClient });
    const transactionBytes = Buffer.from(bytes).toString("base64");

    res.json({ success: true, data: { transactionBytes } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /marketplace/delist
 */
router.post("/delist", async (req, res, next) => {
  try {
    requireFields(req.body, ["walletAddress", "listingId"]);
    const { walletAddress, listingId } = req.body;
    requireSuiAddress(walletAddress, "walletAddress");
    requireSuiAddress(listingId, "listingId");

    if (!isContractDeployed()) {
      return res.status(503).json({
        success: false,
        error: "Contract not deployed. Set CONTRACT_PACKAGE_ID in .env",
      });
    }

    const tx = new Transaction();
    tx.setSender(walletAddress);

    tx.moveCall({
      target: `${CONTRACT_PACKAGE_ID}::marketplace::delist`,
      arguments: [
        tx.object(MARKETPLACE_ID),
        tx.object(listingId),
      ],
    });

    const bytes = await tx.build({ client: suiClient });
    const transactionBytes = Buffer.from(bytes).toString("base64");

    res.json({ success: true, data: { transactionBytes } });
  } catch (err) {
    next(err);
  }
});

export default router;
