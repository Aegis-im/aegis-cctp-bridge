/*
 * SPDX-License-Identifier: Apache-2.0
 */

import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

import { burnForDepositSolViaProxy } from "./v2/solanaProxy";
import { receiveMessageSol, reclaimEventAccount } from "./v2/solana";
import {
  depositForBurnEvm,
  depositForBurnEvmWithHook,
  receiveMessageEvm,
} from "./v2/evm";

export const DEFAULT_IRIS_API_URL = "https://iris-api-sandbox.circle.com";

export type Sol2EvmParams = {
  amount: BN;
  maxFee: BN;
  minFinalityThreshold: number;
};

export type Evm2SolParams = {
  amount: number;
  maxFee: number;
  minFinalityThreshold: number;
  hookData?: string;
  remoteDomain: number;
};

export type ReclaimParams = {
  attestationHex: string;
  destinationMessageHex: string;
  messageSentEventAccount: string;
};

export async function fetchAttestationV2(txHash: string, domainId: number, irisApiUrl?: string) {
  const baseUrl = (irisApiUrl ?? process.env.IRIS_API_URL ?? DEFAULT_IRIS_API_URL).trim();
  let attestationResponse: any = {};

  while (true) {
    const response = await fetch(
      `${baseUrl}/v2/messages/${domainId}?transactionHash=${txHash}`
    );
    attestationResponse = await response.json();

    const entry = attestationResponse?.messages?.[0];
    if (attestationResponse?.error || !entry || entry.attestation === "PENDING") {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }

    return entry as { message: string; attestation: string };
  }
}

export async function sol2evm(params: Sol2EvmParams) {
  const depositTxHash = await burnForDepositSolViaProxy(
    params.amount,
    params.maxFee,
    params.minFinalityThreshold
  );

  const attestation = await fetchAttestationV2(depositTxHash, Number(5));
  console.log("Attestation:", attestation);
  const receiveTxHash = await receiveMessageEvm(attestation.message, attestation.attestation);

  return { depositTxHash, receiveTxHash };
}

export async function evm2sol(params: Evm2SolParams) {
  const depositTxHash = params.hookData
    ? await depositForBurnEvmWithHook(
        params.amount,
        params.maxFee,
        params.minFinalityThreshold,
        params.hookData
      )
    : await depositForBurnEvm(params.amount, params.maxFee, params.minFinalityThreshold);

  const attestation = await fetchAttestationV2(depositTxHash, params.remoteDomain);
  console.log("Attestation:", attestation);
  const receiveTxHash = await receiveMessageSol(attestation.message, attestation.attestation);

  return { depositTxHash, receiveTxHash };
}

export async function reclaim(params: ReclaimParams) {
  const reclaimTxHash = await reclaimEventAccount(
    Buffer.from(params.attestationHex.replace("0x", ""), "hex"),
    Buffer.from(params.destinationMessageHex.replace("0x", ""), "hex"),
    new PublicKey(params.messageSentEventAccount)
  );

  return { reclaimTxHash };
}
