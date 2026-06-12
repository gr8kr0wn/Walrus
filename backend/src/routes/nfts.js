import { Router } from "express";
import { suiClient, CONTRACT_PACKAGE_ID, WALRUS_AGGREGATOR_URL } from "../sui-client.js";
import { requireSuiAddress } from "../middleware/validate.js";
import { isContractDeployed } from "../config.js";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Derive a rarity label from royalty_bps stored on the NFT.
 */
function rarityFromBps(bps) {
  if (bps >= 1000) return "Legendary";
  if (bps >= 700) return "Epic";
  if (bps >= 400) return "Rare";
  return "Common";
}

/**
 * Map a raw Sui NFT object's fields to the shape the frontend expects.
 * Shape: { id, name, collection, price, rarity, type, art, blob_id, creator }
 */
function mapNftFields(objectId, fields) {
  const blobId = fields?.blob_id ?? "";
  const mediaType = fields?.media_type ?? "image/png";
  const royaltyBps = Number(fields?.royalty_bps ?? 0);
  const priceInMist = BigInt(fields?.price ?? 0);
  const priceInSui = (Number(priceInMist) / 1_000_000_000).toFixed(2);

  // Derive a simple type tag from the MIME type.
  let type = "art";
  if (mediaType.startsWith("video/")) type = "video";
  else if (mediaType.includes("3d") || mediaType.includes("model")) type = "3d";

  // Build a Walrus aggregator URL — try primary, fall back to alternatives
  const WALRUS_AGGREGATORS = [
    WALRUS_AGGREGATOR_URL,
    "https://wal-aggregator-testnet.staketab.org/v1",
    "https://walrus-testnet-aggregator.nodes.guru/v1",
    "https://walrus.testnet.pops.one/v1",
  ];

  const art = blobId
    ? `${WALRUS_AGGREGATORS[0]}/${blobId}`
    : "linear-gradient(145deg,#10172a,#081017)";

  return {
    id: objectId,
    name: fields?.name ?? "Unnamed NFT",
    collection: fields?.collection ?? fields?.collection_name ?? "Unknown Collection",
    price: `${priceInSui} SUI`,
    rarity: rarityFromBps(royaltyBps),
    type,
    art,
    blob_id: blobId,
    creator: fields?.creator ?? "",
    listed: fields?.listed ?? false,
    media_type: mediaType,
    description: fields?.description ?? "",
  };
}

/**
 * Fetch NFT objects from a list of object IDs.
 */
async function fetchNftObjects(objectIds) {
  if (!objectIds.length) return [];

  const objects = await suiClient.multiGetObjects({
    ids: objectIds,
    options: { showContent: true, showType: true },
  });

  return objects
    .filter((obj) => obj.data?.content?.dataType === "moveObject")
    .map((obj) => mapNftFields(obj.data.objectId, obj.data.content.fields));
}

/**
 * Fetch all NFTs from testnet using Mysten's GraphQL API.
 * This returns NFTs from ALL contracts on testnet, not just ours.
 */
async function fetchAllTestnetNFTs() {
  const query = `
    query {
      objects(
        filter: { type: "0x2::display::Display" }
        first: 50
      ) {
        nodes {
          address
          display {
            key
            value
          }
          asMoveObject {
            contents {
              type { repr }
              json
            }
          }
        }
      }
    }
  `;

  try {
    const res = await fetch("https://sui-testnet.mystenlabs.com/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(8000),
    });
    const json = await res.json();
    return json?.data?.objects?.nodes ?? [];
  } catch {
    return [];
  }
}

/**
 * Map a GraphQL NFT node to the frontend shape.
 */
function mapGraphQLNft(node) {
  const display = {};
  (node.display || []).forEach(({ key, value }) => { display[key] = value; });

  const blobId = display.blob_id || display.image_url || "";
  const art = blobId
    ? (blobId.startsWith("http") ? blobId : `${WALRUS_AGGREGATOR_URL}/${blobId}`)
    : "linear-gradient(145deg,#10172a,#081017)";

  return {
    id: node.address,
    name: display.name || "Unnamed NFT",
    collection: display.collection || display.project_name || "Unknown Collection",
    price: display.price ? `${display.price} SUI` : "—",
    rarity: "Common",
    type: "art",
    art,
    blob_id: blobId,
    creator: display.creator || "",
    listed: false,
    description: display.description || "",
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /nfts
 * Returns NFTs from your contract + all other NFTs on testnet via GraphQL.
 */
router.get("/", async (req, res, next) => {
  try {
    // Fetch from your contract first
    let ownNfts = [];
    if (isContractDeployed()) {
      try {
        const events = await suiClient.queryEvents({
          query: { MoveEventType: `${CONTRACT_PACKAGE_ID}::nft::NFTMinted` },
          limit: 50,
          order: "descending",
        });
        const objectIds = events.data.map((e) => e.parsedJson?.nft_id).filter(Boolean);
        ownNfts = await fetchNftObjects(objectIds);

        // Fetch active marketplace listings
        try {
          const [listEvs, soldEvs, delistEvs] = await Promise.all([
            suiClient.queryEvents({
              query: { MoveEventType: `${CONTRACT_PACKAGE_ID}::marketplace::ListEvent` },
              limit: 100,
            }),
            suiClient.queryEvents({
              query: { MoveEventType: `${CONTRACT_PACKAGE_ID}::marketplace::NFTSold` },
              limit: 100,
            }),
            suiClient.queryEvents({
              query: { MoveEventType: `${CONTRACT_PACKAGE_ID}::marketplace::DelistEvent` },
              limit: 100,
            }),
          ]);

          const inactiveListingIds = new Set([
            ...soldEvs.data.map((e) => e.parsedJson?.listing_id),
            ...delistEvs.data.map((e) => e.parsedJson?.listing_id),
          ].filter(Boolean));

          const activeListingsMap = new Map(); // nft_id -> { listing_id, price, seller }
          for (const e of listEvs.data) {
            const lid = e.parsedJson?.listing_id;
            const nid = e.parsedJson?.nft_id;
            if (lid && nid && !inactiveListingIds.has(lid)) {
              activeListingsMap.set(nid, {
                listing_id: lid,
                price: e.parsedJson?.price,
                seller: e.parsedJson?.seller,
              });
            }
          }

          // Map own NFTs that are active listings to ListingObject shape
          ownNfts = ownNfts.map((nft) => {
            const listing = activeListingsMap.get(nft.id);
            if (listing) {
              const priceInSui = (Number(listing.price) / 1_000_000_000).toFixed(2);
              return {
                ...nft,
                id: listing.listing_id, // Replace object ID with ListingObject ID for buy logic
                nft_id: nft.id, // Store original NFT object ID
                price: `${priceInSui} SUI`,
                listed: true,
                seller: listing.seller,
              };
            }
            return nft;
          });
        } catch (err) {
          console.error("Failed to fetch and map marketplace listings:", err);
        }
      } catch { /* ignore */ }
    }

    // Fetch from Mysten GraphQL (all testnet NFTs with Display)
    let graphqlNfts = [];
    try {
      const nodes = await fetchAllTestnetNFTs();
      graphqlNfts = nodes
        .map(mapGraphQLNft)
        .filter((n) => n.name !== "Unnamed NFT");
    } catch { /* ignore */ }

    // Merge — own NFTs first, then deduplicate by id
    const seen = new Set(ownNfts.map((n) => n.id));
    const merged = [
      ...ownNfts,
      ...graphqlNfts.filter((n) => !seen.has(n.id)),
    ];

    res.json(merged);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /nfts/:id
 * Returns a single NFT by its Sui object ID.
 */
router.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    requireSuiAddress(id, "id");

    const obj = await suiClient.getObject({
      id,
      options: { showContent: true, showType: true },
    });

    if (!obj.data || obj.data.content?.dataType !== "moveObject") {
      return res.status(404).json({ error: "NFT not found" });
    }

    const nft = mapNftFields(obj.data.objectId, obj.data.content.fields);
    res.json(nft);
  } catch (err) {
    next(err);
  }
});

router.get("/owner/:address", async (req, res, next) => {
  try {
    const { address } = req.params;
    requireSuiAddress(address, "address");

    if (!isContractDeployed()) {
      return res.json([]);
    }

    const ownedObjects = await suiClient.getOwnedObjects({
      owner: address,
      filter: {
        StructType: `${CONTRACT_PACKAGE_ID}::nft::WalrusMintNFT`,
      },
      options: { showContent: true, showType: true },
    });

    const nfts = ownedObjects.data
      .filter((item) => item.data?.content?.dataType === "moveObject")
      .map((item) => mapNftFields(item.data.objectId, item.data.content.fields));

    res.json(nfts);
  } catch (err) {
    next(err);
  }
});

export default router;
