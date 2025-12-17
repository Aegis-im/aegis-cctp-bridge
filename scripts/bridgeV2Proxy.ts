/*
 * SPDX-License-Identifier: Apache-2.0
 */

import { minimist } from "zx";
import { BN } from "@coral-xyz/anchor";

import { evm2sol, reclaim, sol2evm } from "./bridgeV2Proxy.utils";

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
    const { depositTxHash, receiveTxHash } = await sol2evm({
      amount: new BN(args.amount),
      maxFee: new BN(args.maxFee),
      minFinalityThreshold: args.minFinalityThreshold,
    });
    console.log("DepositForBurn txHash:", depositTxHash);
    console.log("ReceiveMessage txHash:", receiveTxHash);
  } else if (commandName === CommandName.Evm2Sol) {
    const { depositTxHash, receiveTxHash } = await evm2sol({
      amount: args.amount,
      maxFee: args.maxFee,
      minFinalityThreshold: args.minFinalityThreshold,
      hookData: args.hookData,
      remoteDomain: Number(process.env.REMOTE_EVM_DOMAIN),
    });
    console.log("DepositForBurn txHash:", depositTxHash);
    console.log("ReceiveMessage txHash:", receiveTxHash);
  } else if (commandName === CommandName.ReclaimEventAccount) {
    const { reclaimTxHash } = await reclaim({
      attestationHex: args.attestation,
      destinationMessageHex: args.destinationMessage,
      messageSentEventAccount: args.messageSentEventAccount,
    });
    console.log("ReclaimEventAccount txHash:", reclaimTxHash);
  } else {
    console.error("Command must be one of: ", Object.values(CommandName).join(", "));
    process.exit(1);
  }
};

main();
