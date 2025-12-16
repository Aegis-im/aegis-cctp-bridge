import * as fs from 'fs'
import * as path from 'path'
import { Wallet } from 'ethers'

// Helper function to read networks configuration with token replacement
export function getNetworksConfigForHardhat() {
  try {
    const configPath = path.join(__dirname, '..', 'config', 'networks.json')
    const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'))

    // Replace {DEPLOYER_ADDRESS} tokens with actual deployer address
    const deployerAddress = getDeployerAddressForHardhat()
    if (deployerAddress) {
      replaceDeployerAddressTokensForHardhat(configData, deployerAddress)
    }

    return configData
  } catch (error) {
    console.error(`❌ Error reading networks config: ${(error as any).message}`)
    return null
  }
}

// Helper function to get deployer address from private key (for hardhat config)
function getDeployerAddressForHardhat(): string | null {
  try {
    const privateKey = process.env.PRIVATE_KEY
    if (!privateKey) {
      return null
    }

    // Use ethers v6 without importing from hardhat
    const wallet = new Wallet(privateKey)
    return wallet.address
  } catch (error) {
    console.error(`❌ Error getting deployer address: ${(error as any).message}`)
    return null
  }
}

// Helper function to recursively replace {DEPLOYER_ADDRESS} tokens (for hardhat config)
function replaceDeployerAddressTokensForHardhat(obj: any, deployerAddress: string): void {
  for (const key in obj) {
    if (typeof obj[key] === 'string' && obj[key] === '{DEPLOYER_ADDRESS}') {
      obj[key] = deployerAddress
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      replaceDeployerAddressTokensForHardhat(obj[key], deployerAddress)
    }
  }
}


