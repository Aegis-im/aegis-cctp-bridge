/*
 * SPDX-License-Identifier: Apache-2.0
 */

import "dotenv/config";
import * as anchor from "@coral-xyz/anchor";
import * as spl from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

import DEPOSIT_PROXY_V2_IDL from "../solana_programs/v2/target/idl/deposit_proxy_v2.json";
import { DepositProxyV2 } from "../solana_programs/v2/target/types/deposit_proxy_v2";
import { findProgramAddress, getAnchorConnection } from "./utils";
import { sol2evm } from "./bridgeV2Proxy.utils";

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

const run = async () => {
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

  if (balanceBaseUnits < threshold) {
    console.log(
      `Skip: vault balance ${balanceBaseUnits.toString()} < threshold ${threshold.toString()}`
    );
    return;
  }

  console.log(`Bridge: vault balance ${balanceBaseUnits.toString()}`);

  const { depositTxHash, receiveTxHash } = await sol2evm({
    amount: new BN(balanceBaseUnits.toString()),
    maxFee: new BN(0),
    minFinalityThreshold: 2000,
  });

  console.log("DepositForBurn txHash:", depositTxHash);
  console.log("ReceiveMessage txHash:", receiveTxHash);
};

run().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
