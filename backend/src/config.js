/**
 * Loads and validates environment variables.
 * Import this module early (after dotenv/config) to get a validated config object.
 */
import "dotenv/config";
import { getFullnodeUrl } from "@mysten/sui/client";

const network = process.env.SUI_NETWORK || "testnet";

export const config = {
  port: parseInt(process.env.PORT || "3001", 10),
  network,
  rpcUrl: process.env.SUI_RPC_URL || getFullnodeUrl(network),
  contractPackageId: process.env.CONTRACT_PACKAGE_ID || "",
  collectionRegistryId: process.env.COLLECTION_REGISTRY_ID || "",
  marketplaceId: process.env.MARKETPLACE_ID || "",
  walrusAggregatorUrl:
    process.env.WALRUS_AGGREGATOR_URL ||
    "https://aggregator.walrus-testnet.walrus.space/v1",
  marketplaceFeeAddress: process.env.MARKETPLACE_FEE_ADDRESS || "",
  allowedOrigins: (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
};

/**
 * Returns true if the contract has been deployed (package ID is set and not a placeholder).
 */
export function isContractDeployed() {
  return (
    !!config.contractPackageId &&
    !config.contractPackageId.startsWith("0x_")
  );
}
