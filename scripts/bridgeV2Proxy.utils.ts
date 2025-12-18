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
const DEFAULT_IRIS_ATTESTATION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export type Sol2EvmParams = {
  amount: BN;
  maxFee: BN;
  minFinalityThreshold: number;
  signal?: AbortSignal;
};

export type Evm2SolParams = {
  amount: number;
  maxFee: number;
  minFinalityThreshold: number;
  hookData?: string;
  remoteDomain: number;
  signal?: AbortSignal;
};

export type ReclaimParams = {
  attestationHex: string;
  destinationMessageHex: string;
  messageSentEventAccount: string;
};

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Aborted"));
    const onAbort = () => {
      cleanup();
      reject(new Error("Aborted"));
    };
    const t = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const cleanup = () => {
      clearTimeout(t);
      try {
        signal?.removeEventListener("abort", onAbort);
      } catch {}
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

export async function fetchAttestationV2(
  txHash: string,
  domainId: number,
  irisApiUrl?: string,
  opts?: { signal?: AbortSignal; timeoutMs?: number }
) {
  const baseUrl = (irisApiUrl ?? process.env.IRIS_API_URL ?? DEFAULT_IRIS_API_URL).trim();
  let attestationResponse: any = {};
  const startedAt = Date.now();
  let tries = 0;
  const timeoutMs = Number(process.env.IRIS_ATTESTATION_TIMEOUT_MS ?? DEFAULT_IRIS_ATTESTATION_TIMEOUT_MS);
  const maxWaitMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_IRIS_ATTESTATION_TIMEOUT_MS;
  const signal = opts?.signal;
  const url = `${baseUrl}/v2/messages/${domainId}?transactionHash=${txHash}`;
  let lastStatus: string | undefined;

  const fetchWithTimeout = async (url: string, timeoutMs: number) => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      return await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(t);
      try {
        signal?.removeEventListener("abort", onAbort);
      } catch {}
    }
  };

  while (true) {
    if (signal?.aborted) throw new Error("Aborted");
    tries += 1;
    try {
      const response = await fetchWithTimeout(url, 15000);
      attestationResponse = await response.json();
    } catch (e) {
      // Network / timeout: retry
      attestationResponse = { error: true };
    }

    const entry = attestationResponse?.messages?.[0];
    if (attestationResponse?.error || !entry || entry.attestation === "PENDING") {
      if (tries === 1) console.log(`Attestation: txHash:`,txHash, 'url:',url);
      if (tries % 30 === 0) {
        const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
        const status = entry?.status ?? "unknown";
        if (status !== lastStatus) lastStatus = status;
        console.log(`Attestation pending: txHash:`, txHash, 'status:',status, 'elapsed:',elapsedSec);
      }
      if (Date.now() - startedAt > maxWaitMs) {
        const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
        const status = entry?.status ?? "unknown";
        throw new Error(`Attestation timeout (status=${status} elapsed=${elapsedSec}s)`);
      }
      await sleep(2000, signal);
      continue;
    }

    const status = entry?.status ?? "unknown";
    console.log(`Attestation complete: txHash:`,txHash, 'status:',status);
    return entry as { message: string; attestation: string };
  }
}

export async function sol2evm(params: Sol2EvmParams) {
  const depositTxHash = await burnForDepositSolViaProxy(
    params.amount,
    params.maxFee,
    params.minFinalityThreshold
  );
  console.log("DepositForBurn txHash:", depositTxHash);

  const attestation = await fetchAttestationV2(depositTxHash, Number(5), undefined, {
    signal: params.signal,
  });
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

  const attestation = await fetchAttestationV2(depositTxHash, params.remoteDomain, undefined, {
    signal: params.signal,
  });
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
