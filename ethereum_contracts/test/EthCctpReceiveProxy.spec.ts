import { expect } from "chai";
import { ethers } from "hardhat";

describe("EthCctpReceiveProxy", function () {
  async function deployFixture() {
    const [admin, manager, transferTo, other] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const token = await MockERC20.deploy("Mock", "MOCK", 6);

    const Proxy = await ethers.getContractFactory("EthCctpReceiveProxy");
    const proxy = await Proxy.deploy(admin.address, manager.address, transferTo.address);

    const MockMessageTransmitter = await ethers.getContractFactory("MockMessageTransmitter");
    const transmitter = await MockMessageTransmitter.deploy(await token.getAddress(), await proxy.getAddress(), 0);

    return { admin, manager, transferTo, other, token, proxy, transmitter };
  }

  it("deploy: stores admin/manager/transferTo and rejects zero addresses", async function () {
    const [admin, manager, transferTo] = await ethers.getSigners();
    const Proxy = await ethers.getContractFactory("EthCctpReceiveProxy");

    const okProxy = await Proxy.deploy(admin.address, manager.address, transferTo.address);
    await okProxy.waitForDeployment();

    const deployWith = async (a: string, m: string, t: string) => {
      const c = await Proxy.deploy(a, m, t);
      const tx = c.deploymentTransaction();
      if (!tx) throw new Error("Missing deployment transaction");
      await tx.wait();
    };

    await expect(deployWith(ethers.ZeroAddress, manager.address, transferTo.address)).to.be.revertedWithCustomError(
      okProxy,
      "ZeroAddress"
    );
    await expect(deployWith(admin.address, ethers.ZeroAddress, transferTo.address)).to.be.revertedWithCustomError(
      okProxy,
      "ZeroAddress"
    );
    await expect(deployWith(admin.address, manager.address, ethers.ZeroAddress)).to.be.revertedWithCustomError(
      okProxy,
      "ZeroAddress"
    );

    expect(await okProxy.admin()).to.eq(admin.address);
    expect(await okProxy.manager()).to.eq(manager.address);
    expect(await okProxy.transferTo()).to.eq(transferTo.address);
  });

  it("admin setters: only admin", async function () {
    const { admin, manager, transferTo, other, proxy } = await deployFixture();

    await expect(proxy.connect(other).setManager(other.address)).to.be.revertedWithCustomError(proxy, "NotAdmin");
    await expect(proxy.connect(other).setTransferTo(other.address)).to.be.revertedWithCustomError(proxy, "NotAdmin");
    await expect(proxy.connect(other).setAdmin(other.address)).to.be.revertedWithCustomError(proxy, "NotAdmin");

    await expect(proxy.connect(admin).setManager(other.address))
      .to.emit(proxy, "ManagerUpdated")
      .withArgs(manager.address, other.address);
    await expect(proxy.connect(admin).setTransferTo(other.address))
      .to.emit(proxy, "TransferToUpdated")
      .withArgs(transferTo.address, other.address);
    await expect(proxy.connect(admin).setAdmin(other.address))
      .to.emit(proxy, "AdminUpdated")
      .withArgs(admin.address, other.address);

    expect(await proxy.manager()).to.eq(other.address);
    expect(await proxy.transferTo()).to.eq(other.address);
    expect(await proxy.admin()).to.eq(other.address);
  });

  it("receiveMessageAndForward: only manager or admin; forwards delta balance", async function () {
    const { admin, manager, transferTo, other, token, proxy, transmitter } = await deployFixture();

    const msgBytes = "0x1234";
    const attestBytes = "0xabcd";

    await expect(
      proxy.connect(other).receiveMessageAndForward(await transmitter.getAddress(), await token.getAddress(), msgBytes, attestBytes)
    ).to.be.revertedWithCustomError(proxy, "NotManagerOrAdmin");

    await transmitter.connect(other).setAmountToMint(1000);

    const beforeTo = await token.balanceOf(transferTo.address);
    const ret = await proxy
      .connect(manager)
      .receiveMessageAndForward(await transmitter.getAddress(), await token.getAddress(), msgBytes, attestBytes);

    await expect(ret)
      .to.emit(proxy, "MessageReceivedAndForwarded")
      .withArgs(manager.address, await transmitter.getAddress(), await token.getAddress(), 1000);

    const afterTo = await token.balanceOf(transferTo.address);
    expect(afterTo - beforeTo).to.eq(1000);
    expect(await token.balanceOf(await proxy.getAddress())).to.eq(0);
  });

  it("receiveMessageAndForward: forwards 0 when no tokens received", async function () {
    const { manager, transferTo, token, proxy, transmitter } = await deployFixture();

    await transmitter.setAmountToMint(0);

    const beforeTo = await token.balanceOf(transferTo.address);
    await proxy
      .connect(manager)
      .receiveMessageAndForward(await transmitter.getAddress(), await token.getAddress(), "0x", "0x");
    const afterTo = await token.balanceOf(transferTo.address);

    expect(afterTo).to.eq(beforeTo);
  });

  it("rescue_transfer: only admin", async function () {
    const { admin, other, token, proxy } = await deployFixture();

    await token.mint(await proxy.getAddress(), 777);

    await expect(proxy.connect(other).rescue_transfer(await token.getAddress(), other.address, 1)).to.be.revertedWithCustomError(
      proxy,
      "NotAdmin"
    );

    await expect(proxy.connect(admin).rescue_transfer(await token.getAddress(), other.address, 200))
      .to.emit(proxy, "RescueTransfer")
      .withArgs(await token.getAddress(), other.address, 200);

    expect(await token.balanceOf(other.address)).to.eq(200);
    expect(await token.balanceOf(await proxy.getAddress())).to.eq(577);
  });
});


