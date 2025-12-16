/*
 * SPDX-License-Identifier: Apache-2.0
 */

import "dotenv/config";
import { minimist } from "zx";
import { receiveMessageEvm } from "./v2/evm";

const IRIS_API_URL = process.env.IRIS_API_URL ?? "https://iris-api-sandbox.circle.com";
const DEFAULT_SOLANA_SRC_DOMAIN_ID = 5;

type ParsedArgs = {
  txHash: string;
  domainId: number;
};

async function fetchAttestation(txHash: string, domainId: number) {
  let msg: any;
  while (true) {
    const resp = await fetch(`${IRIS_API_URL}/v2/messages/${domainId}?transactionHash=${txHash}`);
    msg = await resp.json();

    const entry = msg?.messages?.[0];
    if (msg?.error || !entry || entry.attestation === "PENDING") {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }

    return entry as { message: string; attestation: string };
  }
}

async function main() {
  const raw = minimist(process.argv.slice(2), {
    string: ["txHash", "domainId"],
  });

  const args: ParsedArgs = {
    txHash: String(raw.txHash ?? "").trim(),
    domainId: raw.domainId ? Number(raw.domainId) : DEFAULT_SOLANA_SRC_DOMAIN_ID,
  };

  if (!args.txHash) {
    throw new Error("--txHash is required (Solana burn tx signature)");
  }
  if (!Number.isFinite(args.domainId)) {
    throw new Error("--domainId must be a number");
  }

  console.log("Fetching attestation...");
  const { message, attestation } = await fetchAttestation(args.txHash, args.domainId);

  const receiveTxHash = await receiveMessageEvm(message, attestation);
  console.log("ReceiveMessage txHash:", receiveTxHash);
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});


