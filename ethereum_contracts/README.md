### Deploy to Sepolia (saves address in `deployments/sepolia/`)

```bash
ADMIN=0x8af05b6df31035aeba506e7afc40af348cbe4ae1 \
MANAGER=0x715A04FF3F6d77b8B9150C44aE88295bF541C149 \
TRANSFER_TO=0x05fB40Ba63f92f9e0FE479B55f2BA277b6BB2831 \
yarn hardhat deploy --network sepolia --tags EthCctpReceiveProxy
```

```bash
yarn hardhat verify --network sepolia 0x0146347C5465D7ED237EEF3D1199B6807ECB8613 0x8af05b6df31035aeba506e7afc40af348cbe4ae1 0x715A04FF3F6d77b8B9150C44aE88295bF541C149 0x05fB40Ba63f92f9e0FE479B55f2BA277b6BB2831
```

