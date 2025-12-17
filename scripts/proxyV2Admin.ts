/*
 * SPDX-License-Identifier: Apache-2.0
 */

import * as anchor from "@coral-xyz/anchor";
import { minimist } from "zx";
import * as spl from "@solana/spl-token";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { getBytes } from "ethers";

import DEPOSIT_PROXY_V2_IDL from "../solana_programs/v2/target/idl/deposit_proxy_v2.json";
import { DepositProxyV2 } from "../solana_programs/v2/target/types/deposit_proxy_v2";
import { evmAddressToBytes32, findProgramAddress, getAnchorConnection } from "./utils";
import { getProgramsV2 } from "./v2/utilsV2";

const SOLANA_USDC_ADDRESS =
  process.env.SOLANA_USDC_ADDRESS ??
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

type Command =
  | "vault-ata"
  | "set-manager"
  | "init-vault"
  | "list-vaults"
  | "set-destination";

const parseVaultId32 = (raw: string): Buffer => {
  const v = (raw ?? "").trim();
  if (!v) throw new Error("--vaultId is required");
  const hex = v.startsWith("0x") ? v.slice(2) : v;
  if (hex.length !== 64) throw new Error("vaultId must be 32-byte hex (64 chars)");
  return Buffer.from(hex, "hex");
};

const getDepositProxyProgram = (provider: anchor.AnchorProvider) => {
  return new anchor.Program<DepositProxyV2>(
    DEPOSIT_PROXY_V2_IDL as DepositProxyV2,
    provider
  );
};

const BPF_UPGRADEABLE_LOADER_ID = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

const main = async () => {
  const command = process.argv.slice(2)[0] as Command;
  const raw = minimist(process.argv.slice(3), {
    string: ["vaultId", "newManager", "destinationDomain", "mintRecipient", "destinationCaller"],
  });

  const provider = getAnchorConnection();
  const { messageTransmitterProgram, tokenMessengerMinterProgram } = getProgramsV2(provider);
  const depositProxyProgram = getDepositProxyProgram(provider);

  const usdcMint = new PublicKey(process.env.SOLANA_USDC_ADDRESS ?? SOLANA_USDC_ADDRESS);

  if (command === "list-vaults") {
    // Prefer Anchor's built-in account fetcher (most reliable across IDL variants)
    const vaultAccountClient = (depositProxyProgram.account as any)?.vault;
    if (vaultAccountClient?.all) {
      const all = await vaultAccountClient.all();
      for (const v of all) {
        const decoded: any = v.account;
        const vaultIdHex = Buffer.from(decoded.vaultId ?? decoded.vault_id).toString("hex");
        const admin = (decoded.admin as PublicKey).toBase58();
        const transferManager = (decoded.transferManager ?? decoded.transfer_manager as PublicKey).toBase58();
        const destinationDomain = Number(decoded.destinationDomain ?? decoded.destination_domain);
        const mintRecipientPk = (decoded.mintRecipient ?? decoded.mint_recipient) as PublicKey;
        const mintRecipient = mintRecipientPk.toBase58();
        const mintRecipientBytes = Buffer.from(mintRecipientPk.toBytes());
        const mintRecipientEvm = `0x${mintRecipientBytes.subarray(12).toString("hex")}`;
        const destinationCaller = (decoded.destinationCaller ?? decoded.destination_caller as PublicKey).toBase58();
        process.stdout.write(
          `pubkey=${v.publicKey.toBase58()} vault=${vaultIdHex} admin=${admin} transfer_manager=${transferManager} destination_domain=${destinationDomain} mint_recipient=${mintRecipient} mint_recipient_evm=${mintRecipientEvm} destination_caller=${destinationCaller}\n`
        );
      }
      return;
    }

    // Fallback: manual scan + decode (case-sensitive IDL names differ across Anchor builds)
    const vaultDisc = Buffer.from([211, 8, 232, 43, 2, 152, 117, 119]); // from IDL
    const discB58 = anchor.utils.bytes.bs58.encode(vaultDisc);
    const accounts = await provider.connection.getProgramAccounts(depositProxyProgram.programId, {
      filters: [{ memcmp: { offset: 0, bytes: discB58 } }],
    });

    for (const a of accounts) {
      const decoded: any = depositProxyProgram.coder.accounts.decode("vault", a.account.data);
      const vaultIdHex = Buffer.from(decoded.vaultId ?? decoded.vault_id).toString("hex");
      const admin = (decoded.admin as PublicKey).toBase58();
      const transferManager = (decoded.transferManager ?? decoded.transfer_manager as PublicKey).toBase58();
      const destinationDomain = Number(decoded.destinationDomain ?? decoded.destination_domain);
      const mintRecipientPk = (decoded.mintRecipient ?? decoded.mint_recipient) as PublicKey;
      const mintRecipient = mintRecipientPk.toBase58();
      const mintRecipientBytes = Buffer.from(mintRecipientPk.toBytes());
      const mintRecipientEvm = `0x${mintRecipientBytes.subarray(12).toString("hex")}`;
      const destinationCaller = (decoded.destinationCaller ?? decoded.destination_caller as PublicKey).toBase58();
      process.stdout.write(
        `pubkey=${a.pubkey.toBase58()} vault=${vaultIdHex} admin=${admin} transfer_manager=${transferManager} destination_domain=${destinationDomain} mint_recipient=${mintRecipient} mint_recipient_evm=${mintRecipientEvm} destination_caller=${destinationCaller}\n`
      );
    }
    return;
  }

  const vaultId = parseVaultId32(raw.vaultId ?? process.env.DEPOSIT_PROXY_V2_VAULT_ID);
  const vaultPda = findProgramAddress("vault", depositProxyProgram.programId, [vaultId]).publicKey;
  const vaultAuthority = findProgramAddress("vault_authority", depositProxyProgram.programId, [vaultPda]).publicKey;

  if (command === "vault-ata") {
    const ata = await spl.getAssociatedTokenAddress(usdcMint, vaultAuthority, true);
    process.stdout.write(`${ata.toBase58()}\n`);
    return;
  }

  if (command === "set-manager") {
    const newManager = new PublicKey(raw.newManager);
    const sig = await depositProxyProgram.methods
      .setTransferManager(newManager)
      .accountsPartial({
        admin: provider.wallet.publicKey,
        vault: vaultPda,
      })
      .rpc();
    console.log(sig);
    return;
  }

  if (command === "init-vault") {
    const destinationDomain = Number(process.env.REMOTE_EVM_DOMAIN);
    if (!Number.isFinite(destinationDomain)) throw new Error("REMOTE_EVM_DOMAIN is required");

    const mintRecipient = new PublicKey(
      getBytes(evmAddressToBytes32(process.env.REMOTE_EVM_ADDRESS))
    );
    const destinationCaller =
      process.env.DESTINATION_CALLER && process.env.DESTINATION_CALLER.trim() !== ""
        ? new PublicKey(process.env.DESTINATION_CALLER)
        : new PublicKey("11111111111111111111111111111111");

    const vaultTokenAccount = await spl.getAssociatedTokenAddress(usdcMint, vaultAuthority, true);

    const [programData] = PublicKey.findProgramAddressSync(
      [depositProxyProgram.programId.toBuffer()],
      BPF_UPGRADEABLE_LOADER_ID
    );

    const sig = await depositProxyProgram.methods
      .initializeVault(
        Array.from(vaultId),
        destinationDomain,
        mintRecipient,
        destinationCaller
      )
      .accountsPartial({
        payer: provider.wallet.publicKey,
        program: depositProxyProgram.programId,
        programData,
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

    console.log(sig);
    return;
  }

  if (command === "set-destination") {
    const destinationDomain = raw.destinationDomain
      ? Number(raw.destinationDomain)
      : Number(process.env.REMOTE_EVM_DOMAIN);
    if (!Number.isFinite(destinationDomain)) throw new Error("destinationDomain (or REMOTE_EVM_DOMAIN) is required");

    const mintRecipientEvm =
      (raw.mintRecipient as string | undefined)?.trim() || (process.env.REMOTE_EVM_ADDRESS ?? "").trim();
    if (!mintRecipientEvm) throw new Error("mintRecipient (or REMOTE_EVM_ADDRESS) is required");
    const mintRecipient = new PublicKey(getBytes(evmAddressToBytes32(mintRecipientEvm)));

    const destinationCallerRaw =
      (raw.destinationCaller as string | undefined)?.trim() ??
      (process.env.DESTINATION_CALLER ?? "").trim();
    const destinationCaller =
      destinationCallerRaw && destinationCallerRaw !== ""
        ? new PublicKey(destinationCallerRaw)
        : new PublicKey("11111111111111111111111111111111");

    const sig = await depositProxyProgram.methods
      .setDestination(destinationDomain, mintRecipient, destinationCaller)
      .accountsPartial({
        admin: provider.wallet.publicKey,
        vault: vaultPda,
      })
      .rpc();
    console.log(sig);
    return;
  }

  throw new Error("Unknown command");
};

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
