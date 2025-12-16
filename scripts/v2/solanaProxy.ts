/*
 * SPDX-License-Identifier: Apache-2.0
 */

import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import * as spl from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { getBytes } from "ethers";

import DEPOSIT_PROXY_V2_IDL from "../../programs/v2/target/idl/deposit_proxy_v2.json";
import { DepositProxyV2 } from "../../programs/v2/target/types/deposit_proxy_v2";
import { evmAddressToBytes32, findProgramAddress, getAnchorConnection } from "../utils";
import { getDepositForBurnPdasV2, getProgramsV2 } from "./utilsV2";

export const SOLANA_USDC_ADDRESS =
  process.env.SOLANA_USDC_ADDRESS ??
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

const parseVaultId32 = (): Buffer => {
  const raw = (process.env.DEPOSIT_PROXY_V2_VAULT_ID ?? "").trim();
  if (!raw) throw new Error("DEPOSIT_PROXY_V2_VAULT_ID is required (32-byte hex)");
  const hex = raw.startsWith("0x") ? raw.slice(2) : raw;
  if (hex.length !== 64) throw new Error("DEPOSIT_PROXY_V2_VAULT_ID must be 32-byte hex (64 chars)");
  return Buffer.from(hex, "hex");
};

const getDepositProxyProgram = (provider: anchor.AnchorProvider) => {
  return new anchor.Program<DepositProxyV2>(
    DEPOSIT_PROXY_V2_IDL as DepositProxyV2,
    provider
  );
};

export const burnForDepositSolViaProxy = async (
  amount: BN,
  maxFee: BN,
  minFinalityThreshold: number
): Promise<string> => {
  console.log("Depositing for burn on Solana via DepositProxyV2...");

  const provider = getAnchorConnection();
  const { messageTransmitterProgram, tokenMessengerMinterProgram } = getProgramsV2(provider);
  const depositProxyProgram = getDepositProxyProgram(provider);

  const usdcMint = new PublicKey(SOLANA_USDC_ADDRESS);
  const vaultId = parseVaultId32();

  const vaultPda = findProgramAddress("vault", depositProxyProgram.programId, [vaultId]).publicKey;
  const vaultAuthority = findProgramAddress(
    "vault_authority",
    depositProxyProgram.programId,
    [vaultPda]
  ).publicKey;

  const vault = await depositProxyProgram.account.vault.fetch(vaultPda);
  const destinationDomain = Number(vault.destinationDomain);

  const vaultTokenAccount = await spl.getAssociatedTokenAddress(
    usdcMint,
    vaultAuthority,
    true
  );

  const pdas = getDepositForBurnPdasV2(
    { messageTransmitterProgram, tokenMessengerMinterProgram },
    usdcMint,
    destinationDomain
  );

  const denylistAccount = findProgramAddress(
    "denylist_account",
    tokenMessengerMinterProgram.programId,
    [vaultAuthority]
  ).publicKey;

  const eventAuthority = findProgramAddress(
    "__event_authority",
    tokenMessengerMinterProgram.programId
  ).publicKey;

  const messageSentEventAccountKeypair = Keypair.generate();

  return await depositProxyProgram.methods
    .burnForDeposit(amount, maxFee, minFinalityThreshold)
    .accountsPartial({
      transferManager: provider.wallet.publicKey,
      eventRentPayer: provider.wallet.publicKey,
      vault: vaultPda,
      vaultAuthority,
      vaultTokenAccount,
      senderAuthorityPda: pdas.authorityPda.publicKey,
      denylistAccount,
      tokenMessenger: pdas.tokenMessengerAccount.publicKey,
      remoteTokenMessenger: pdas.remoteTokenMessengerKey.publicKey,
      tokenMinter: pdas.tokenMinterAccount.publicKey,
      localToken: pdas.localToken.publicKey,
      burnTokenMint: usdcMint,
      messageTransmitter: pdas.messageTransmitterAccount.publicKey,
      messageSentEventData: messageSentEventAccountKeypair.publicKey,
      messageTransmitterProgram: messageTransmitterProgram.programId,
      tokenMessengerMinterProgram: tokenMessengerMinterProgram.programId,
      tokenProgram: spl.TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      eventAuthority,
    })
    .signers([messageSentEventAccountKeypair])
    .rpc();
};

export const initVaultViaProxy = async (): Promise<string> => {
  const provider = getAnchorConnection();
  const { messageTransmitterProgram, tokenMessengerMinterProgram } = getProgramsV2(provider);
  const depositProxyProgram = getDepositProxyProgram(provider);

  const usdcMint = new PublicKey(SOLANA_USDC_ADDRESS);
  const vaultId = parseVaultId32();

  const destinationDomain = Number(process.env.REMOTE_EVM_DOMAIN);
  if (!Number.isFinite(destinationDomain)) throw new Error("REMOTE_EVM_DOMAIN is required");

  const mintRecipient = new PublicKey(
    getBytes(evmAddressToBytes32(process.env.REMOTE_EVM_ADDRESS))
  );

  const destinationCaller =
    process.env.DESTINATION_CALLER && process.env.DESTINATION_CALLER.trim() !== ""
      ? new PublicKey(process.env.DESTINATION_CALLER)
      : new PublicKey("11111111111111111111111111111111");

  const vaultPda = findProgramAddress("vault", depositProxyProgram.programId, [vaultId]).publicKey;
  const vaultAuthority = findProgramAddress(
    "vault_authority",
    depositProxyProgram.programId,
    [vaultPda]
  ).publicKey;

  const vaultTokenAccount = await spl.getAssociatedTokenAddress(usdcMint, vaultAuthority, true);

  return await depositProxyProgram.methods
    .initializeVault(Array.from(vaultId), destinationDomain, mintRecipient, destinationCaller)
    .accountsPartial({
      payer: provider.wallet.publicKey,
      vault: vaultPda,
      vaultAuthority,
      burnTokenMint: usdcMint,
      vaultTokenAccount,
      messageTransmitterProgram: messageTransmitterProgram.programId,
      tokenMessengerMinterProgram: tokenMessengerMinterProgram.programId,
      tokenProgram: spl.TOKEN_PROGRAM_ID,
      associatedTokenProgram: spl.ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
};
