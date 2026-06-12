/**
 * WalrusMint backend test suite.
 *
 * Starts the server on a random port, runs HTTP assertions, then exits.
 * Tests that require a real deployed contract will receive a 503 / empty
 * array — that is the expected behaviour when CONTRACT_PACKAGE_ID is not set.
 */

import { startServer } from "./index.js";

const BASE = "http://localhost";
let server;
let port;

const results = [];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function get(path) {
  const res = await fetch(`${BASE}:${port}${path}`);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function post(path, payload) {
  const res = await fetch(`${BASE}:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

function pass(name) {
  results.push({ name, ok: true });
  console.log(`  ✓  ${name}`);
}

function fail(name, reason) {
  results.push({ name, ok: false, reason });
  console.error(`  ✗  ${name}`);
  console.error(`     ${reason}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

async function testHealth() {
  const { status, body } = await get("/health");
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body?.status === "ok", `Expected status "ok", got ${JSON.stringify(body?.status)}`);
  assert(typeof body?.network === "string", "Expected network string");
  pass("GET /health returns 200 with status:ok");
}

async function testGetNfts() {
  const { status, body } = await get("/nfts");
  assert(status === 200, `Expected 200, got ${status}`);
  assert(Array.isArray(body), `Expected array, got ${typeof body}`);
  // When contract is not deployed, we expect an empty array — that's fine.
  if (body.length > 0) {
    const nft = body[0];
    assert(typeof nft.id !== "undefined", "NFT missing id");
    assert(typeof nft.name === "string", "NFT missing name");
    assert(typeof nft.collection === "string", "NFT missing collection");
    assert(typeof nft.price === "string", "NFT missing price");
  }
  pass("GET /nfts returns 200 with array (empty is OK when contract not deployed)");
}

async function testGetNftsOwner() {
  // Use a valid-looking address; will return empty array without a real contract.
  const addr = "0x" + "a".repeat(64);
  const { status, body } = await get(`/nfts/owner/${addr}`);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(Array.isArray(body), `Expected array, got ${typeof body}`);
  pass("GET /nfts/owner/:address returns 200 with array");
}

async function testGetActivity() {
  const { status, body } = await get("/activity");
  assert(status === 200, `Expected 200, got ${status}`);
  assert(Array.isArray(body), `Expected array, got ${typeof body}`);
  pass("GET /activity returns 200 with array");
}

async function testGetRankings() {
  const { status, body } = await get("/rankings");
  assert(status === 200, `Expected 200, got ${status}`);
  assert(Array.isArray(body), `Expected array, got ${typeof body}`);
  pass("GET /rankings returns 200 with array");
}

async function testPostMintShape() {
  const payload = {
    walletAddress: "0x" + "b".repeat(64),
    blobId: "walrus-test-blob-id-123",
    mediaType: "image/png",
    name: "Test NFT",
    description: "A test NFT",
    collectionName: "Test Collection",
    price: "1000000000",
    royaltyBps: 500,
  };

  const { status, body } = await post("/mint", payload);

  if (status === 200) {
    // Response may be { transactionBytes } directly or { success, data: { transactionBytes } }
    const txBytes = body?.transactionBytes ?? body?.data?.transactionBytes;
    assert(
      typeof txBytes === "string",
      `Expected transactionBytes string, got ${JSON.stringify(body)}`
    );
    pass("POST /mint returns { transactionBytes: string } (contract deployed)");
  } else if (status === 503) {
    assert(
      typeof (body?.error ?? body?.data?.error) === "string",
      `Expected error string in 503 body, got ${JSON.stringify(body)}`
    );
    pass("POST /mint returns 503 with error message (contract not deployed — expected)");
  } else {
    throw new Error(`Unexpected status ${status}: ${JSON.stringify(body)}`);
  }
}

async function testPostMintValidation() {
  // Missing required fields should return 400.
  const { status, body } = await post("/mint", { walletAddress: "0x123" });
  assert(status === 400, `Expected 400 for missing fields, got ${status}`);
  assert(typeof body?.error === "string", "Expected error message");
  pass("POST /mint with missing fields returns 400");
}

async function testPostBuyShape() {
  const payload = {
    walletAddress: "0x" + "c".repeat(64),
    listingId: "0x" + "d".repeat(64),
  };

  const { status, body } = await post("/marketplace/buy", payload);

  if (status === 200) {
    assert(
      typeof body?.transactionBytes === "string",
      `Expected transactionBytes string, got ${JSON.stringify(body)}`
    );
    pass("POST /marketplace/buy returns { transactionBytes: string } (contract deployed)");
  } else if (status === 503 || status === 400 || status === 500) {
    // 503 = contract not configured, 400/500 = object not found on chain — all expected without a real contract.
    assert(
      typeof body?.error === "string",
      `Expected error string, got ${JSON.stringify(body)}`
    );
    pass(`POST /marketplace/buy returns ${status} with error (contract not deployed — expected)`);
  } else {
    throw new Error(`Unexpected status ${status}: ${JSON.stringify(body)}`);
  }
}

async function testPostBuyValidation() {
  const { status, body } = await post("/marketplace/buy", {});
  assert(status === 400, `Expected 400 for missing fields, got ${status}`);
  assert(typeof body?.error === "string", "Expected error message");
  pass("POST /marketplace/buy with missing fields returns 400");
}

async function testPostOffersShape() {
  const payload = {
    walletAddress: "0x" + "e".repeat(64),
    listingId: "0x" + "f".repeat(64),
    offerAmount: 500000000,
  };

  const { status, body } = await post("/marketplace/offers", payload);

  if (status === 200) {
    assert(typeof body?.transactionBytes === "string", "Expected transactionBytes");
    pass("POST /marketplace/offers returns { transactionBytes: string }");
  } else if (status === 503 || status === 400 || status === 500) {
    pass(`POST /marketplace/offers returns ${status} (contract not deployed — expected)`);
  } else {
    throw new Error(`Unexpected status ${status}: ${JSON.stringify(body)}`);
  }
}

async function test404() {
  const { status } = await get("/nonexistent-route");
  assert(status === 404, `Expected 404, got ${status}`);
  pass("Unknown routes return 404");
}

// ── Runner ────────────────────────────────────────────────────────────────────

async function run() {
  console.log("\nWalrusMint Backend Tests\n");

  // Pick a random high port to avoid conflicts.
  port = 3100 + Math.floor(Math.random() * 900);
  server = await startServer(port);

  const tests = [
    testHealth,
    testGetNfts,
    testGetNftsOwner,
    testGetActivity,
    testGetRankings,
    testPostMintShape,
    testPostMintValidation,
    testPostBuyShape,
    testPostBuyValidation,
    testPostOffersShape,
    test404,
  ];

  for (const t of tests) {
    try {
      await t();
    } catch (err) {
      fail(t.name, err.message);
    }
  }

  server.close();

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  console.log(`\n${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    console.error("Failed tests:");
    results.filter((r) => !r.ok).forEach((r) => console.error(`  - ${r.name}: ${r.reason}`));
    process.exit(1);
  } else {
    process.exit(0);
  }
}

run().catch((err) => {
  console.error("Test runner crashed:", err);
  if (server) server.close();
  process.exit(1);
});
