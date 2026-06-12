import { SuiClient } from "@mysten/sui/client";
import { config } from "./config.js";

export const suiClient = new SuiClient({ url: config.rpcUrl });

// Re-export config values for convenience in route files.
export const CONTRACT_PACKAGE_ID = config.contractPackageId;
export const COLLECTION_REGISTRY_ID = config.collectionRegistryId;
export const MARKETPLACE_ID = config.marketplaceId;
export const WALRUS_AGGREGATOR_URL = config.walrusAggregatorUrl;

// Keep backward-compat alias used by existing mint.js route.
export const MARKETPLACE_REGISTRY_ID = config.collectionRegistryId;
