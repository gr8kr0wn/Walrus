import { Router } from "express";
import { Transaction } from "@mysten/sui/transactions";
import { suiClient, CONTRACT_PACKAGE_ID, COLLECTION_REGISTRY_ID } from "../sui-client.js";
import { requireFields, requireSuiAddress, requirePositiveInt } from "../middleware/validate.js";
import { isContractDeployed, config } from "../config.js";

const router = Router();

/**
 * POST /mint
 * Builds an unsigned Transaction calling nft::mint (and optionally
 * collection_registry::register_entry if the registry is configured).
 * Returns { success: true, data: { transactionBytes: "<base64>" } }
 *
 * Body:
 *   walletAddress   — signer's Sui address
 *   blobId          — Walrus blob ID of the media asset
 *   metadata: {
 *     name            — NFT name
 *     description     — NFT description
 *     collection      — collection label
 *     price           — asking price in MIST (string or number)
 *     royalty         — royalty in basis points (0–10000)
 *     mediaType       — MIME type, e.g. "image/png"
 *   }
 *
 * Also accepts flat body fields for backward compatibility:
 *   mediaType, name, description, collectionName, price, royaltyBps
 */
router.post("/", async (req, res, next) => {
  try {
    const body = req.body;

    // Support both nested metadata object and flat fields.
    const walletAddress = body.walletAddress;
    const blobId = body.blobId;

    const meta = body.metadata || {};
    const name = meta.name ?? body.name;
    const description = meta.description ?? body.description ?? "";
    const collection = meta.collection ?? body.collectionName ?? body.collection ?? "";
    const mediaType = meta.mediaType ?? body.mediaType ?? "application/octet-stream";
    const price = meta.price ?? body.price;
    const royaltyBps = meta.royalty ?? body.royaltyBps ?? 0;

    // Validate required fields.
    if (!walletAddress) {
      const err = new Error("Missing required fields: walletAddress");
      err.status = 400;
      throw err;
    }
    if (!blobId) {
      const err = new Error("Missing required fields: blobId");
      err.status = 400;
      throw err;
    }
    if (!name) {
      const err = new Error("Missing required fields: name (in metadata or body)");
      err.status = 400;
      throw err;
    }
    if (price === undefined || price === null || price === "") {
      const err = new Error("Missing required fields: price (in metadata or body)");
      err.status = 400;
      throw err;
    }

    requireSuiAddress(walletAddress, "walletAddress");
    requirePositiveInt(price, "price");

    const royaltyNum = Number(royaltyBps);
    if (!Number.isInteger(royaltyNum) || royaltyNum < 0 || royaltyNum > 10_000) {
      const err = new Error("royaltyBps must be an integer between 0 and 10000");
      err.status = 400;
      throw err;
    }

    if (!isContractDeployed()) {
      return res.status(503).json({
        success: false,
        error: "Contract not deployed. Set CONTRACT_PACKAGE_ID in .env",
      });
    }

    const tx = new Transaction();
    tx.setSender(walletAddress);

    // Call nft::mint
    const [mintedNft] = tx.moveCall({
      target: `${CONTRACT_PACKAGE_ID}::nft::mint`,
      arguments: [
        tx.pure.string(name),
        tx.pure.string(description),
        tx.pure.string(blobId),
        tx.pure.string(mediaType),
        tx.pure.u64(BigInt(price)),
        tx.pure.string(collection),
        tx.pure.u16(royaltyNum),
      ],
    });

    // Optionally register in the collection registry.
    if (COLLECTION_REGISTRY_ID && !COLLECTION_REGISTRY_ID.startsWith("0x_")) {
      tx.moveCall({
        target: `${CONTRACT_PACKAGE_ID}::collection_registry::register_entry`,
        arguments: [
          tx.object(COLLECTION_REGISTRY_ID),
          tx.pure.address(walletAddress), // placeholder — actual nft_id not available pre-execution
        ],
      });
    }

    const bytes = await tx.build({ client: suiClient });
    const transactionBytes = Buffer.from(bytes).toString("base64");

    res.json({ success: true, data: { transactionBytes } });
  } catch (err) {
    next(err);
  }
});

export default router;
