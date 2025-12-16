/*
 * SPDX-License-Identifier: Apache-2.0
 */

import { minimist } from "zx";
import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

import { burnForDepositSolViaProxy } from "./v2/solanaProxy";
import { receiveMessageSol, reclaimEventAccount } from "./v2/solana";
import { depositForBurnEvm, depositForBurnEvmWithHook, receiveMessageEvm } from "./v2/evm";

export const IRIS_API_URL =
  process.env.IRIS_API_URL ?? "https://iris-api-sandbox.circle.com";

enum CommandName {
  Sol2Evm = "sol2evm",
  Evm2Sol = "evm2sol",
  ReclaimEventAccount = "reclaim",
}

interface ParsedArgs {
  amount: number;
  maxFee: number;
  minFinalityThreshold: number;
  hookData: string;
  attestation: string;
  destinationMessage: string;
  messageSentEventAccount: string;
}

const main = async () => {
  const commandName: CommandName = process.argv.slice(2)[0] as CommandName;

  const rawArgs = minimist(process.argv.slice(3), {
    string: [
      "amount",
      "maxFee",
      "minFinalityThreshold",
      "hookData",
      "attestation",
      "destinationMessage",
      "messageSentEventAccount",
    ],
  });

  const args: ParsedArgs = {
    amount: Number(rawArgs.amount),
    maxFee: Number(rawArgs.maxFee),
    minFinalityThreshold: Number(rawArgs.minFinalityThreshold),
    hookData: rawArgs.hookData,
    attestation: rawArgs.attestation,
    destinationMessage: rawArgs.destinationMessage,
    messageSentEventAccount: rawArgs.messageSentEventAccount,
  };

  if (commandName === CommandName.Sol2Evm) {
    const depositTxHash = await burnForDepositSolViaProxy(
      new BN(args.amount),
      new BN(args.maxFee),
      args.minFinalityThreshold
    );
    console.log("DepositForBurn txHash:", depositTxHash);
    const attestationResponse = await fetchAttestation(depositTxHash, Number(5));
    const receiveTxHash = await receiveMessageEvm(
      attestationResponse.message,
      attestationResponse.attestation
    );
    console.log("ReceiveMessage txHash:", receiveTxHash);
  } else if (commandName === CommandName.Evm2Sol) {
    const depositTxHash = args.hookData
      ? await depositForBurnEvmWithHook(
          args.amount,
          args.maxFee,
          args.minFinalityThreshold,
          args.hookData
        )
      : await depositForBurnEvm(
          args.amount,
          args.maxFee,
          args.minFinalityThreshold
        );
    console.log("DepositForBurn txHash:", depositTxHash);
    const attestationResponse = await fetchAttestation(
      depositTxHash,
      Number(process.env.REMOTE_EVM_DOMAIN)
    );
    const receiveTxHash = await receiveMessageSol(
      attestationResponse.message,
      attestationResponse.attestation
    );
    console.log("ReceiveMessage txHash:", receiveTxHash);
  } else if (commandName === CommandName.ReclaimEventAccount) {
    const reclaimTxHash = await reclaimEventAccount(
      Buffer.from(args.attestation.replace("0x", ""), "hex"),
      Buffer.from(args.destinationMessage.replace("0x", ""), "hex"),
      new PublicKey(args.messageSentEventAccount)
    );
    console.log("ReclaimEventAccount txHash:", reclaimTxHash);
  } else {
    console.error("Command must be one of: ", Object.values(CommandName).join(", "));
    process.exit(1);
  }
};

const fetchAttestation = async (txHash: string, domainId: number) => {
  console.log("Fetching attestation...");
  let attestationResponse: any = {};
  while (true) {
    const response = await fetch(
      `${IRIS_API_URL}/v2/messages/${domainId}?transactionHash=${txHash}`
    );
    attestationResponse = await response.json();
    if (
      attestationResponse.error ||
      !attestationResponse.messages ||
      attestationResponse.messages?.[0]?.attestation === "PENDING"
    ) {
      await new Promise((r) => setTimeout(r, 2000));
    } else {
      break;
    }
  }
  console.log("Attestation response:", attestationResponse);
  return attestationResponse.messages[0];
};

main();
