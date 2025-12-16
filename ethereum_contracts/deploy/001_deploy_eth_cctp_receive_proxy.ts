import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const admin = process.env.ADMIN;
  const manager = process.env.MANAGER;
  const transferTo = process.env.TRANSFER_TO;

  if (!admin || !manager || !transferTo) {
    throw new Error("Missing env vars: ADMIN, MANAGER, TRANSFER_TO");
  }

  console.log("Deploying EthCctpReceiveProxy with admin:", admin, "manager:", manager, "transferTo:", transferTo);

  const deployment = await deploy("EthCctpReceiveProxy", {
    from: deployer,
    args: [admin, manager, transferTo],
    log: true,
  });

  console.log("\nVerify command:");
  console.log(
    `cd ${process.cwd()} && ETHERSCAN_API_KEY=... yarn hardhat verify --network ${hre.network.name} ${deployment.address} ${admin} ${manager} ${transferTo}\n`
  );
};

export default func;
func.tags = ["EthCctpReceiveProxy"];


