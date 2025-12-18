/*
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from "node:path";

import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import * as spl from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import dotenv from "dotenv";

import DEPOSIT_PROXY_V2_IDL from "../solana_programs/v2/target/idl/deposit_proxy_v2.json";
import { DepositProxyV2 } from "../solana_programs/v2/target/types/deposit_proxy_v2";
import { sol2evm } from "./bridgeV2Proxy.utils";
import { findProgramAddress, getAnchorConnection } from "./utils";

dotenv.config({
  path: (process.env.DOTENV_CONFIG_PATH ?? path.resolve(__dirname, "../.env")).trim(),
});

const DEFAULT_SOLANA_USDC_ADDRESS = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

const parseVaultId32 = (): Buffer => {
  const raw = (process.env.DEPOSIT_PROXY_V2_VAULT_ID ?? "").trim();
  if (!raw) throw new Error("DEPOSIT_PROXY_V2_VAULT_ID is required (32-byte hex)");
  const hex = raw.startsWith("0x") ? raw.slice(2) : raw;
  if (hex.length !== 64) throw new Error("DEPOSIT_PROXY_V2_VAULT_ID must be 32-byte hex (64 chars)");
  return Buffer.from(hex, "hex");
};

const getDepositProxyProgram = (provider: anchor.AnchorProvider) => {
  return new anchor.Program<DepositProxyV2>(DEPOSIT_PROXY_V2_IDL as DepositProxyV2, provider);
};

const getThresholdAmount = (): bigint => {
  const raw = (process.env.DEPOSIT_PROXY_V2_MIN_BRIDGE_AMOUNT ?? "").trim();
  if (!raw) throw new Error("DEPOSIT_PROXY_V2_MIN_BRIDGE_AMOUNT is required (base units, integer)");
  const v = BigInt(raw);
  if (v < BigInt(0)) throw new Error("DEPOSIT_PROXY_V2_MIN_BRIDGE_AMOUNT must be >= 0");
  return v;
};

const getIntervalMs = (): number => {
  const raw = (process.env.DEPOSIT_PROXY_V2_POLL_INTERVAL_MS ?? "60000").trim();
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 1000) throw new Error("DEPOSIT_PROXY_V2_POLL_INTERVAL_MS must be >= 1000");
  return v;
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

async function tick(): Promise<void> {
  const threshold = getThresholdAmount();
  const provider = getAnchorConnection();
  const depositProxyProgram = getDepositProxyProgram(provider);

  const usdcMint = new PublicKey(
    (process.env.SOLANA_USDC_ADDRESS ?? process.env.USDC_ADDRESS ?? DEFAULT_SOLANA_USDC_ADDRESS).trim()
  );

  const vaultId = parseVaultId32();
  const vaultPda = findProgramAddress("vault", depositProxyProgram.programId, [vaultId]).publicKey;
  const vaultAuthority = findProgramAddress(
    "vault_authority",
    depositProxyProgram.programId,
    [vaultPda]
  ).publicKey;

  const vaultTokenAccount = await spl.getAssociatedTokenAddress(usdcMint, vaultAuthority, true);
  const balanceResp = await provider.connection.getTokenAccountBalance(vaultTokenAccount);
  const balanceBaseUnits = BigInt(balanceResp.value.amount);

  console.log(`Tick: balance=${balanceBaseUnits.toString()}, min amount threshold=${threshold.toString()}`);

  if (balanceBaseUnits < threshold) return;

  console.log(`Bridge: amount=${balanceBaseUnits.toString()}`);

  const { depositTxHash, receiveTxHash } = await sol2evm({
    amount: new BN(balanceBaseUnits.toString()),
    maxFee: new BN(0),
    minFinalityThreshold: 2000,
    signal: currentAbort?.signal,
  });

  console.log(`Bridge complete: solanaTxHash=${depositTxHash} evmTxHash=${receiveTxHash}`);
}

let currentAbort: AbortController | null = null;

async function main(): Promise<void> {
  const intervalMs = getIntervalMs();

  let stopped = false;
  const stop = () => {
    stopped = true;
    try {
      currentAbort?.abort();
    } catch {}
    // Fallback: ensure process exits promptly even if something is stuck
    setTimeout(() => process.exit(0), 500).unref();
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  const origLog = console.log.bind(console);
  const origErr = console.error.bind(console);
  const ts = () => new Date().toISOString();
  console.log = (...args: any[]) => origLog(`[${ts()}]`, ...args);
  console.error = (...args: any[]) => origErr(`[${ts()}]`, ...args);

  console.log(`Daemon started (intervalMs=${intervalMs})`);

  while (!stopped) {
    currentAbort = new AbortController();
    try {
      await tick();
    } catch (e: any) {
      console.error(e?.message ?? e);
    }
    if (stopped) break;
    try {
      await sleep(intervalMs, currentAbort.signal);
    } catch {}
    currentAbort = null;
  }

  console.log("Daemon stopped");
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
