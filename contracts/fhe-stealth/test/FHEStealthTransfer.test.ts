import { expect } from "chai";
import hre, { ethers } from "hardhat";
import {
  FHEStealthTransfer,
  ConfidentialToken,
  MockUSDC,
} from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Encryptable } from "@cofhe/sdk";

describe("FHEStealthTransfer", function () {
  let stealthTransfer: FHEStealthTransfer;
  let token: ConfidentialToken;
  let usdc: MockUSDC;
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let stealthAddr1: HardhatEthersSigner;
  let stealthAddr2: HardhatEthersSigner;

  const MINT_AMOUNT = 10_000_000n; // 10 USDC
  const DEPOSIT_AMOUNT = 5_000_000n; // 5 USDC
  const SEND_AMOUNT = 1_000_000n; // 1 USDC

  const EPHEMERAL_PUB_KEY = ethers.concat(["0x02", ethers.randomBytes(32)]);
  const METADATA = ethers.concat(["0xab", ethers.randomBytes(4)]);

  beforeEach(async function () {
    [owner, alice, bob, stealthAddr1, stealthAddr2] =
      await ethers.getSigners();

    const UsdcFactory = await ethers.getContractFactory("MockUSDC");
    usdc = (await UsdcFactory.deploy()) as MockUSDC;
    await usdc.waitForDeployment();

    const TokenFactory = await ethers.getContractFactory("ConfidentialToken");
    token = (await TokenFactory.deploy(
      await usdc.getAddress(),
      owner.address
    )) as ConfidentialToken;
    await token.waitForDeployment();

    const StealthFactory = await ethers.getContractFactory(
      "FHEStealthTransfer"
    );
    stealthTransfer = (await StealthFactory.deploy(
      await token.getAddress(),
      owner.address
    )) as FHEStealthTransfer;
    await stealthTransfer.waitForDeployment();

    // Fund alice: mint USDC -> approve -> deposit into ConfidentialToken
    await usdc.mint(alice.address, MINT_AMOUNT);
    const tokenAddr = await token.getAddress();
    await usdc.connect(alice).approve(tokenAddr, DEPOSIT_AMOUNT);

    await token.connect(alice).deposit(DEPOSIT_AMOUNT);

    // Alice approves the stealth transfer contract to move her encrypted tokens
    const stealthAddr = await stealthTransfer.getAddress();
    await token.connect(alice).approve(stealthAddr, true);
  });

  // FHE input verification checks msg.sender at the ConfidentialToken level.
  // When FHEStealthTransfer calls confidentialTransferFrom, msg.sender = FHEStealthTransfer.
  // So encrypted inputs must be created with the stealth contract address as the account.
  async function encryptForStealth(signer: HardhatEthersSigner, amounts: bigint[]) {
    const cofheClient = await hre.cofhe.createClientWithBatteries(signer);
    const stealthAddr = await stealthTransfer.getAddress();
    return cofheClient
      .encryptInputs(amounts.map((a) => Encryptable.uint64(a)))
      .setAccount(stealthAddr)
      .execute();
  }

  describe("constructor", function () {
    it("should set the token address", async function () {
      expect(await stealthTransfer.token()).to.equal(
        await token.getAddress()
      );
    });

    it("should set SCHEME_ID to 1 (secp256k1)", async function () {
      expect(await stealthTransfer.SCHEME_ID()).to.equal(1);
    });

    it("should reject zero address for token", async function () {
      const Factory = await ethers.getContractFactory("FHEStealthTransfer");
      await expect(
        Factory.deploy(ethers.ZeroAddress, owner.address)
      ).to.be.revertedWithCustomError(stealthTransfer, "ZeroAddress");
    });
  });

  describe("stealthSend", function () {
    it("should transfer encrypted tokens to stealth address", async function () {
      const [encAmount] = await encryptForStealth(alice, [SEND_AMOUNT]);

      await stealthTransfer
        .connect(alice)
        .stealthSend(
          stealthAddr1.address,
          encAmount,
          EPHEMERAL_PUB_KEY,
          METADATA
        );

      expect(await stealthTransfer.totalTransfers()).to.equal(1);
    });

    it("should emit StealthTransfer event with correct fields", async function () {
      const [encAmount] = await encryptForStealth(alice, [SEND_AMOUNT]);

      await expect(
        stealthTransfer
          .connect(alice)
          .stealthSend(
            stealthAddr1.address,
            encAmount,
            EPHEMERAL_PUB_KEY,
            METADATA
          )
      )
        .to.emit(stealthTransfer, "StealthTransfer")
        .withArgs(
          1,
          stealthAddr1.address,
          alice.address,
          ethers.hexlify(EPHEMERAL_PUB_KEY),
          ethers.hexlify(METADATA)
        );
    });

    it("should NOT include amount in StealthTransfer event", async function () {
      const [encAmount] = await encryptForStealth(alice, [SEND_AMOUNT]);

      const tx = await stealthTransfer
        .connect(alice)
        .stealthSend(
          stealthAddr1.address,
          encAmount,
          EPHEMERAL_PUB_KEY,
          METADATA
        );
      const receipt = await tx.wait();

      const stealthTransferAddr = await stealthTransfer.getAddress();
      const stealthLogs = receipt!.logs.filter(
        (log) => log.address.toLowerCase() === stealthTransferAddr.toLowerCase()
      );
      for (const log of stealthLogs) {
        const parsed = stealthTransfer.interface.parseLog({
          topics: log.topics as string[],
          data: log.data,
        });
        expect(parsed!.fragment.inputs.length).to.equal(5);
        const argNames = parsed!.fragment.inputs.map((i) => i.name);
        expect(argNames).to.not.include("amount");
        expect(argNames).to.not.include("encAmount");
      }
    });

    it("should reject zero stealth address", async function () {
      const [encAmount] = await encryptForStealth(alice, [SEND_AMOUNT]);

      await expect(
        stealthTransfer
          .connect(alice)
          .stealthSend(
            ethers.ZeroAddress,
            encAmount,
            EPHEMERAL_PUB_KEY,
            METADATA
          )
      ).to.be.revertedWithCustomError(stealthTransfer, "ZeroAddress");
    });

    it("should reject unapproved caller", async function () {
      const [encAmount] = await encryptForStealth(bob, [SEND_AMOUNT]);

      await expect(
        stealthTransfer
          .connect(bob)
          .stealthSend(
            stealthAddr1.address,
            encAmount,
            EPHEMERAL_PUB_KEY,
            METADATA
          )
      ).to.be.revertedWithCustomError(token, "NotApproved");
    });

    it("should increment totalTransfers sequentially", async function () {
      // #given — two separate stealth sends
      const [enc1] = await encryptForStealth(alice, [SEND_AMOUNT]);
      const [enc2] = await encryptForStealth(alice, [SEND_AMOUNT]);

      // #when — send to two different stealth addresses
      await stealthTransfer
        .connect(alice)
        .stealthSend(stealthAddr1.address, enc1, EPHEMERAL_PUB_KEY, METADATA);
      await stealthTransfer
        .connect(alice)
        .stealthSend(stealthAddr2.address, enc2, EPHEMERAL_PUB_KEY, METADATA);

      // #then — totalTransfers = 2
      expect(await stealthTransfer.totalTransfers()).to.equal(2);
    });
  });

  describe("stealthSendNative", function () {
    it("should forward ETH to stealth address", async function () {
      const sendValue = ethers.parseEther("1.0");
      const balanceBefore = await ethers.provider.getBalance(
        stealthAddr1.address
      );

      await stealthTransfer
        .connect(alice)
        .stealthSendNative(
          stealthAddr1.address,
          EPHEMERAL_PUB_KEY,
          METADATA,
          { value: sendValue }
        );

      const balanceAfter = await ethers.provider.getBalance(
        stealthAddr1.address
      );
      expect(balanceAfter - balanceBefore).to.equal(sendValue);
    });

    it("should emit StealthNativeTransfer event", async function () {
      const sendValue = ethers.parseEther("0.5");

      await expect(
        stealthTransfer
          .connect(alice)
          .stealthSendNative(
            stealthAddr1.address,
            EPHEMERAL_PUB_KEY,
            METADATA,
            { value: sendValue }
          )
      )
        .to.emit(stealthTransfer, "StealthNativeTransfer")
        .withArgs(
          1,
          stealthAddr1.address,
          alice.address,
          ethers.hexlify(EPHEMERAL_PUB_KEY),
          ethers.hexlify(METADATA)
        );
    });

    it("should increment totalTransfers", async function () {
      await stealthTransfer
        .connect(alice)
        .stealthSendNative(
          stealthAddr1.address,
          EPHEMERAL_PUB_KEY,
          METADATA,
          { value: ethers.parseEther("0.1") }
        );

      expect(await stealthTransfer.totalTransfers()).to.equal(1);
    });

    it("should reject zero stealth address", async function () {
      await expect(
        stealthTransfer
          .connect(alice)
          .stealthSendNative(ethers.ZeroAddress, EPHEMERAL_PUB_KEY, METADATA, {
            value: ethers.parseEther("0.1"),
          })
      ).to.be.revertedWithCustomError(stealthTransfer, "ZeroAddress");
    });

    it("should allow sending zero ETH", async function () {
      // #when — send 0 value (no revert, just a zero-value transfer)
      await expect(
        stealthTransfer
          .connect(alice)
          .stealthSendNative(
            stealthAddr1.address,
            EPHEMERAL_PUB_KEY,
            METADATA,
            { value: 0 }
          )
      )
        .to.emit(stealthTransfer, "StealthNativeTransfer");
    });

    it("should not hold ETH in the contract", async function () {
      // #given — send some ETH through stealth
      const sendValue = ethers.parseEther("1.0");
      await stealthTransfer
        .connect(alice)
        .stealthSendNative(
          stealthAddr1.address,
          EPHEMERAL_PUB_KEY,
          METADATA,
          { value: sendValue }
        );

      // #then — contract balance remains zero (ETH forwarded)
      const contractBalance = await ethers.provider.getBalance(
        await stealthTransfer.getAddress()
      );
      expect(contractBalance).to.equal(0n);
    });
  });

  describe("batchStealthSend", function () {
    it("should send to multiple stealth addresses", async function () {
      const [enc1, enc2] = await encryptForStealth(alice, [SEND_AMOUNT, SEND_AMOUNT]);

      const ephKey2 = ethers.concat(["0x03", ethers.randomBytes(32)]);
      const meta2 = ethers.concat(["0xcd", ethers.randomBytes(4)]);

      await stealthTransfer.connect(alice).batchStealthSend([
        {
          stealthAddress: stealthAddr1.address,
          encAmount: enc1,
          ephemeralPubKey: EPHEMERAL_PUB_KEY,
          metadata: METADATA,
        },
        {
          stealthAddress: stealthAddr2.address,
          encAmount: enc2,
          ephemeralPubKey: ephKey2,
          metadata: meta2,
        },
      ]);

      expect(await stealthTransfer.totalTransfers()).to.equal(2);
    });

    it("should emit StealthTransfer for each send", async function () {
      const [enc1, enc2] = await encryptForStealth(alice, [SEND_AMOUNT, SEND_AMOUNT]);

      const tx = await stealthTransfer.connect(alice).batchStealthSend([
        {
          stealthAddress: stealthAddr1.address,
          encAmount: enc1,
          ephemeralPubKey: EPHEMERAL_PUB_KEY,
          metadata: METADATA,
        },
        {
          stealthAddress: stealthAddr2.address,
          encAmount: enc2,
          ephemeralPubKey: EPHEMERAL_PUB_KEY,
          metadata: METADATA,
        },
      ]);
      const receipt = await tx.wait();

      const stealthTransferAddr = await stealthTransfer.getAddress();
      const stealthLogs = receipt!.logs.filter(
        (log) => log.address.toLowerCase() === stealthTransferAddr.toLowerCase()
      );
      expect(stealthLogs.length).to.equal(2);
    });

    it("should reject empty sends array", async function () {
      await expect(
        stealthTransfer.connect(alice).batchStealthSend([])
      ).to.be.revertedWithCustomError(stealthTransfer, "EmptySendsArray");
    });

    it("should reject if any stealth address is zero", async function () {
      const [enc1, enc2] = await encryptForStealth(alice, [SEND_AMOUNT, SEND_AMOUNT]);

      await expect(
        stealthTransfer.connect(alice).batchStealthSend([
          {
            stealthAddress: stealthAddr1.address,
            encAmount: enc1,
            ephemeralPubKey: EPHEMERAL_PUB_KEY,
            metadata: METADATA,
          },
          {
            stealthAddress: ethers.ZeroAddress,
            encAmount: enc2,
            ephemeralPubKey: EPHEMERAL_PUB_KEY,
            metadata: METADATA,
          },
        ])
      ).to.be.revertedWithCustomError(stealthTransfer, "ZeroAddress");
    });

    it("should handle single-element batch", async function () {
      const [enc1] = await encryptForStealth(alice, [SEND_AMOUNT]);

      await stealthTransfer.connect(alice).batchStealthSend([
        {
          stealthAddress: stealthAddr1.address,
          encAmount: enc1,
          ephemeralPubKey: EPHEMERAL_PUB_KEY,
          metadata: METADATA,
        },
      ]);

      expect(await stealthTransfer.totalTransfers()).to.equal(1);
    });

    it("should allow batch send to same stealth address twice", async function () {
      // #given — duplicate stealth addresses in batch
      const [enc1, enc2] = await encryptForStealth(alice, [SEND_AMOUNT, SEND_AMOUNT]);

      // #when — batch with same stealthAddr1 twice
      await stealthTransfer.connect(alice).batchStealthSend([
        {
          stealthAddress: stealthAddr1.address,
          encAmount: enc1,
          ephemeralPubKey: EPHEMERAL_PUB_KEY,
          metadata: METADATA,
        },
        {
          stealthAddress: stealthAddr1.address,
          encAmount: enc2,
          ephemeralPubKey: EPHEMERAL_PUB_KEY,
          metadata: METADATA,
        },
      ]);

      // #then — totalTransfers incremented by 2
      expect(await stealthTransfer.totalTransfers()).to.equal(2);
    });
  });

  describe("mixed transfers", function () {
    it("should track totalTransfers across stealth and native sends", async function () {
      // #given — one encrypted stealth send + one native send
      const [encAmount] = await encryptForStealth(alice, [SEND_AMOUNT]);

      await stealthTransfer
        .connect(alice)
        .stealthSend(stealthAddr1.address, encAmount, EPHEMERAL_PUB_KEY, METADATA);
      await stealthTransfer
        .connect(alice)
        .stealthSendNative(
          stealthAddr2.address,
          EPHEMERAL_PUB_KEY,
          METADATA,
          { value: ethers.parseEther("0.1") }
        );

      // #then — totalTransfers = 2 (both types counted)
      expect(await stealthTransfer.totalTransfers()).to.equal(2);
    });

    it("should start totalTransfers at zero", async function () {
      expect(await stealthTransfer.totalTransfers()).to.equal(0);
    });
  });
});
