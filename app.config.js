const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const BACKEND_URL = isLocal ? "http://localhost:3001" : "https://backend-production-385e.up.railway.app";

window.WALRUSMINT_CONFIG = {
  network: "sui:testnet",
  rpcUrl: "https://fullnode.testnet.sui.io:443",
  walrusPublisherUrl: "https://publisher.walrus-testnet.walrus.space/v1/blobs",
  marketplaceApiUrl: `${BACKEND_URL}/marketplace`,
  mintApiUrl: `${BACKEND_URL}/mint`,
  contractPackageId: "0x0dacbf29da3963e156b6037a20a826ca02bd7da11448644cd377c83438403a5e",
  collectionObjectId: "0x94f76af9093bed0f826b07feeec78f4f411bf0ae1994cde5d5a580d89598f00c",
  backendUrl: BACKEND_URL
};
