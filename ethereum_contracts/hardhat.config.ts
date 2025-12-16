import { HardhatUserConfig } from 'hardhat/config'
import '@nomicfoundation/hardhat-toolbox'
import '@openzeppelin/hardhat-upgrades'
import 'solidity-coverage'
import 'hardhat-deploy'
import * as dotenv from 'dotenv'
import { getNetworksConfigForHardhat } from './utils/config-helpers'

// Load environment variables from .env file
dotenv.config()

// Load network configuration from JSON with token replacement
const networksConfig = getNetworksConfigForHardhat()

if (!networksConfig) {
  throw new Error('Failed to load networks configuration')
}

// Function to build RPC URL with API key replacement
function buildRpcUrl(template: string): string {
  return template.replace('{ALCHEMY_API_KEY}', process.env.ALCHEMY_API_KEY || '')
}

const config: HardhatUserConfig = {
  defaultNetwork: 'hardhat',
  namedAccounts: {
    deployer: {
      default: 0,
    },
  },
  networks: {
    hardhat: {
      chainId: networksConfig.networks.hardhat.chainId,
    },
    mainnet: {
      url: buildRpcUrl(networksConfig.networks.mainnet.rpcUrl),
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gasPrice: networksConfig.networks.mainnet.gasPrice,
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || networksConfig.networks.sepolia.rpcUrl,
      chainId: networksConfig.networks.sepolia.chainId,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gasPrice: networksConfig.networks.sepolia.gasPrice,
    },
  },
  etherscan: {
    apiKey: {
      sepolia: process.env.ETHERSCAN_API_KEY || '',
    },
  },
  solidity: {
    compilers: [
      {
        version: networksConfig.common.solidity.version,
        settings: {
          viaIR: true,
          optimizer: networksConfig.common.solidity.optimizer,
          metadata: {
            // do not include the metadata hash, since this is machine dependent
            // and we want all generated code to be deterministic
            // https://docs.soliditylang.org/en/v0.7.6/metadata.html
            bytecodeHash: 'none',
          },
        },
      },
    ],
  },
  mocha: {
    timeout: 5 * 60 * 1000,
  },
}

export default config

// Export network config for use in scripts
export { networksConfig }


