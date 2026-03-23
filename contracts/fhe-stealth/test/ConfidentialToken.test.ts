import { expect } from "chai";
import hre, { ethers } from "hardhat";
import { ConfidentialToken, MockUSDC } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Encryptable } from "@cofhe/sdk";

describe("ConfidentialToken", function () {
  let token: ConfidentialToken;
  let usdc: MockUSDC;
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;

  const MINT_AMOUNT = 1_000_000n; // 1 USDC (6 decimals)
  const DEPOSIT_AMOUNT = 500_000n; // 0.5 USDC

  beforeEach(async function () {
    [owner, alice, bob] = await ethers.getSigners();

    // Deploy mock USDC
    const UsdcFactory = await ethers.getContractFactory("MockUSDC");
    usdc = (await UsdcFactory.deploy()) as MockUSDC;
    await usdc.waitForDeployment();

    // Deploy ConfidentialToken
    const TokenFactory = await ethers.getContractFactory("ConfidentialToken");
    token = (await TokenFactory.deploy(
      await usdc.getAddress(),
      owner.address
    )) as ConfidentialToken;
    await token.waitForDeployment();

    // Mint USDC to alice and bob for testing
    await usdc.mint(alice.address, MINT_AMOUNT);
    await usdc.mint(bob.address, MINT_AMOUNT);
  });

  describe("constructor", function () {
    it("should set token metadata", async function () {
      expect(await token.name()).to.equal("Confidential USDC");
      expect(await token.symbol()).to.equal("cUSDC");
      expect(await token.decimals()).to.equal(6);
    });

    it("should set underlying token address", async function () {
      expect(await token.underlyingToken()).to.equal(await usdc.getAddress());
    });

    it("should reject zero address for underlying token", async function () {
      const Factory = await ethers.getContractFactory("ConfidentialToken");
      await expect(
        Factory.deploy(ethers.ZeroAddress, owner.address)
      ).to.be.revertedWithCustomError(token, "ZeroAddress");
    });
  });

  describe("deposit", function () {
    it("should pull ERC20 tokens and update totalWrapped", async function () {
      // #given — alice approves ConfidentialToken to spend USDC
      const tokenAddr = await token.getAddress();
      await usdc.connect(alice).approve(tokenAddr, DEPOSIT_AMOUNT);

      // #when — alice deposits plaintext amount (encrypted on-chain)
      await token.connect(alice).deposit(DEPOSIT_AMOUNT);

      // #then — USDC transferred and totalWrapped updated
      expect(await usdc.balanceOf(alice.address)).to.equal(
        MINT_AMOUNT - DEPOSIT_AMOUNT
      );
      expect(await usdc.balanceOf(tokenAddr)).to.equal(DEPOSIT_AMOUNT);
      expect(await token.totalWrapped()).to.equal(DEPOSIT_AMOUNT);
    });

    it("should emit Deposited event", async function () {
      const tokenAddr = await token.getAddress();
      await usdc.connect(alice).approve(tokenAddr, DEPOSIT_AMOUNT);

      await expect(
        token.connect(alice).deposit(DEPOSIT_AMOUNT)
      )
        .to.emit(token, "Deposited")
        .withArgs(alice.address, DEPOSIT_AMOUNT);
    });

    it("should reject zero amount", async function () {
      await expect(
        token.connect(alice).deposit(0)
      ).to.be.revertedWithCustomError(token, "ZeroAmount");
    });
  });

  describe("confidentialTransfer", function () {
    beforeEach(async function () {
      // Alice deposits first
      const tokenAddr = await token.getAddress();
      await usdc.connect(alice).approve(tokenAddr, DEPOSIT_AMOUNT);
      await token.connect(alice).deposit(DEPOSIT_AMOUNT);
    });

    it("should emit ConfidentialTransfer event without amounts", async function () {
      const transferAmount = 100_000n;
      const cofheClient = await hre.cofhe.createClientWithBatteries(alice);
      const [encryptedTransfer] = await cofheClient
        .encryptInputs([Encryptable.uint64(transferAmount)])
        .execute();

      await expect(
        token
          .connect(alice)
          .confidentialTransfer(bob.address, encryptedTransfer)
      )
        .to.emit(token, "ConfidentialTransfer")
        .withArgs(alice.address, bob.address);
    });

    it("should not change totalWrapped on confidential transfer", async function () {
      const transferAmount = 100_000n;
      const cofheClient = await hre.cofhe.createClientWithBatteries(alice);
      const [encryptedTransfer] = await cofheClient
        .encryptInputs([Encryptable.uint64(transferAmount)])
        .execute();

      const wrappedBefore = await token.totalWrapped();
      await token
        .connect(alice)
        .confidentialTransfer(bob.address, encryptedTransfer);
      const wrappedAfter = await token.totalWrapped();

      expect(wrappedAfter).to.equal(wrappedBefore);
    });

    it("should reject transfer to zero address", async function () {
      const cofheClient = await hre.cofhe.createClientWithBatteries(alice);
      const [encryptedTransfer] = await cofheClient
        .encryptInputs([Encryptable.uint64(100_000n)])
        .execute();

      await expect(
        token
          .connect(alice)
          .confidentialTransfer(ethers.ZeroAddress, encryptedTransfer)
      ).to.be.revertedWithCustomError(token, "ZeroAddress");
    });
  });

  describe("confidentialTransferFrom", function () {
    beforeEach(async function () {
      const tokenAddr = await token.getAddress();
      await usdc.connect(alice).approve(tokenAddr, DEPOSIT_AMOUNT);
      await token.connect(alice).deposit(DEPOSIT_AMOUNT);
    });

    it("should reject unapproved caller", async function () {
      const cofheClient = await hre.cofhe.createClientWithBatteries(bob);
      const [encryptedAmount] = await cofheClient
        .encryptInputs([Encryptable.uint64(100_000n)])
        .execute();

      await expect(
        token
          .connect(bob)
          .confidentialTransferFrom(
            alice.address,
            bob.address,
            encryptedAmount
          )
      ).to.be.revertedWithCustomError(token, "NotApproved");
    });

    it("should succeed with approval", async function () {
      // #given — alice approves bob
      await token.connect(alice).approve(bob.address, true);

      // #when — bob calls transferFrom
      const cofheClient = await hre.cofhe.createClientWithBatteries(bob);
      const [encryptedAmount] = await cofheClient
        .encryptInputs([Encryptable.uint64(100_000n)])
        .execute();

      await expect(
        token
          .connect(bob)
          .confidentialTransferFrom(
            alice.address,
            bob.address,
            encryptedAmount
          )
      )
        .to.emit(token, "ConfidentialTransfer")
        .withArgs(alice.address, bob.address);
    });
  });

  describe("admin", function () {
    it("should pause and unpause", async function () {
      await token.pause();
      expect(await token.paused()).to.be.true;

      await token.unpause();
      expect(await token.paused()).to.be.false;
    });

    it("should block deposits when paused", async function () {
      await token.pause();

      await expect(
        token.connect(alice).deposit(DEPOSIT_AMOUNT)
      ).to.be.revertedWithCustomError(token, "EnforcedPause");
    });

    it("should reject pause from non-owner", async function () {
      await expect(
        token.connect(alice).pause()
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });
  });
});
