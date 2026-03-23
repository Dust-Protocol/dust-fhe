import { expect } from "chai";
import { ethers } from "hardhat";
import { FHENameRegistry } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("FHENameRegistry", function () {
  let registry: FHENameRegistry;
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;

  const REGISTRATION_FEE = ethers.parseEther("0.01");

  // 33-byte compressed secp256k1 public keys (0x02 prefix + 32 bytes)
  const SPENDING_KEY = ethers.concat([
    "0x02",
    ethers.randomBytes(32),
  ]);
  const VIEWING_KEY = ethers.concat([
    "0x03",
    ethers.randomBytes(32),
  ]);
  const SPENDING_KEY_2 = ethers.concat([
    "0x02",
    ethers.randomBytes(32),
  ]);
  const VIEWING_KEY_2 = ethers.concat([
    "0x03",
    ethers.randomBytes(32),
  ]);

  beforeEach(async function () {
    [owner, alice, bob] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("FHENameRegistry");
    registry = await Factory.deploy(REGISTRATION_FEE) as FHENameRegistry;
    await registry.waitForDeployment();
  });

  describe("registerName", function () {
    it("should register a name and resolve it", async function () {
      await registry.connect(alice).registerName("sahil", SPENDING_KEY, VIEWING_KEY, {
        value: REGISTRATION_FEE,
      });

      const [spk, vpk] = await registry.resolveName("sahil");
      expect(spk).to.equal(ethers.hexlify(SPENDING_KEY));
      expect(vpk).to.equal(ethers.hexlify(VIEWING_KEY));
    });

    it("should normalize name to lowercase", async function () {
      await registry.connect(alice).registerName("Sahil", SPENDING_KEY, VIEWING_KEY, {
        value: REGISTRATION_FEE,
      });

      const [spk] = await registry.resolveName("sahil");
      expect(spk).to.equal(ethers.hexlify(SPENDING_KEY));
    });

    it("should set primary name on first registration", async function () {
      await registry.connect(alice).registerName("alice", SPENDING_KEY, VIEWING_KEY, {
        value: REGISTRATION_FEE,
      });

      const nameHash = ethers.keccak256(ethers.toUtf8Bytes("alice"));
      expect(await registry.primaryNames(alice.address)).to.equal(nameHash);
    });

    it("should reject duplicate names", async function () {
      await registry.connect(alice).registerName("taken", SPENDING_KEY, VIEWING_KEY, {
        value: REGISTRATION_FEE,
      });

      await expect(
        registry.connect(bob).registerName("taken", SPENDING_KEY, VIEWING_KEY, {
          value: REGISTRATION_FEE,
        })
      ).to.be.revertedWithCustomError(registry, "NameTaken");
    });

    it("should reject insufficient fee", async function () {
      await expect(
        registry.connect(alice).registerName("cheap", SPENDING_KEY, VIEWING_KEY, {
          value: 0,
        })
      ).to.be.revertedWithCustomError(registry, "InsufficientFee");
    });

    it("should reject empty name", async function () {
      await expect(
        registry.connect(alice).registerName("", SPENDING_KEY, VIEWING_KEY, {
          value: REGISTRATION_FEE,
        })
      ).to.be.revertedWithCustomError(registry, "NameEmpty");
    });

    it("should reject invalid characters", async function () {
      await expect(
        registry.connect(alice).registerName("bad.name", SPENDING_KEY, VIEWING_KEY, {
          value: REGISTRATION_FEE,
        })
      ).to.be.revertedWithCustomError(registry, "NameInvalidChars");
    });

    it("should reject invalid pubkey length", async function () {
      const badKey = ethers.randomBytes(20);
      await expect(
        registry.connect(alice).registerName("test", badKey, VIEWING_KEY, {
          value: REGISTRATION_FEE,
        })
      ).to.be.revertedWithCustomError(registry, "InvalidPubKeyLength");
    });

    it("should reject name exceeding 32 characters", async function () {
      const longName = "a".repeat(33);
      await expect(
        registry.connect(alice).registerName(longName, SPENDING_KEY, VIEWING_KEY, {
          value: REGISTRATION_FEE,
        })
      ).to.be.revertedWithCustomError(registry, "NameTooLong");
    });

    it("should accept name at max length boundary (32 chars)", async function () {
      const maxName = "a".repeat(32);
      await registry.connect(alice).registerName(maxName, SPENDING_KEY, VIEWING_KEY, {
        value: REGISTRATION_FEE,
      });

      const [spk] = await registry.resolveName(maxName);
      expect(spk).to.equal(ethers.hexlify(SPENDING_KEY));
    });

    it("should reject name with spaces", async function () {
      await expect(
        registry.connect(alice).registerName("bad name", SPENDING_KEY, VIEWING_KEY, {
          value: REGISTRATION_FEE,
        })
      ).to.be.revertedWithCustomError(registry, "NameInvalidChars");
    });

    it("should accept name with hyphens and underscores", async function () {
      await registry.connect(alice).registerName("my-name_1", SPENDING_KEY, VIEWING_KEY, {
        value: REGISTRATION_FEE,
      });

      const [spk] = await registry.resolveName("my-name_1");
      expect(spk).to.equal(ethers.hexlify(SPENDING_KEY));
    });

    it("should emit NameRegistered event", async function () {
      const nameHash = ethers.keccak256(ethers.toUtf8Bytes("eventtest"));
      await expect(
        registry.connect(alice).registerName("eventtest", SPENDING_KEY, VIEWING_KEY, {
          value: REGISTRATION_FEE,
        })
      )
        .to.emit(registry, "NameRegistered")
        .withArgs(nameHash, alice.address, "eventtest");
    });

    it("should not override primary name on second registration", async function () {
      // #given — alice registers first name (becomes primary)
      await registry.connect(alice).registerName("first", SPENDING_KEY, VIEWING_KEY, {
        value: REGISTRATION_FEE,
      });
      const firstHash = ethers.keccak256(ethers.toUtf8Bytes("first"));

      // #when — alice registers second name
      await registry.connect(alice).registerName("second", SPENDING_KEY, VIEWING_KEY, {
        value: REGISTRATION_FEE,
      });

      // #then — primary name is still the first one
      expect(await registry.primaryNames(alice.address)).to.equal(firstHash);
    });
  });

  describe("resolveName", function () {
    it("should resolve with .dust suffix", async function () {
      await registry.connect(alice).registerName("sahil", SPENDING_KEY, VIEWING_KEY, {
        value: REGISTRATION_FEE,
      });

      const [spk] = await registry.resolveName("sahil.dust");
      expect(spk).to.equal(ethers.hexlify(SPENDING_KEY));
    });

    it("should revert for unregistered name", async function () {
      await expect(
        registry.resolveName("nonexistent")
      ).to.be.revertedWithCustomError(registry, "NameNotActive");
    });
  });

  describe("updateMetaAddress", function () {
    beforeEach(async function () {
      await registry.connect(alice).registerName("alice", SPENDING_KEY, VIEWING_KEY, {
        value: REGISTRATION_FEE,
      });
    });

    it("should update meta address as owner", async function () {
      await registry.connect(alice).updateMetaAddress("alice", SPENDING_KEY_2, VIEWING_KEY_2);

      const [spk, vpk] = await registry.resolveName("alice");
      expect(spk).to.equal(ethers.hexlify(SPENDING_KEY_2));
      expect(vpk).to.equal(ethers.hexlify(VIEWING_KEY_2));
    });

    it("should reject update from non-owner", async function () {
      await expect(
        registry.connect(bob).updateMetaAddress("alice", SPENDING_KEY_2, VIEWING_KEY_2)
      ).to.be.revertedWithCustomError(registry, "NotNameOwner");
    });

    it("should emit NameUpdated event", async function () {
      const nameHash = ethers.keccak256(ethers.toUtf8Bytes("alice"));
      await expect(
        registry.connect(alice).updateMetaAddress("alice", SPENDING_KEY_2, VIEWING_KEY_2)
      )
        .to.emit(registry, "NameUpdated")
        .withArgs(nameHash);
    });

    it("should reject update with invalid pubkey length", async function () {
      const badKey = ethers.randomBytes(20);
      await expect(
        registry.connect(alice).updateMetaAddress("alice", badKey, VIEWING_KEY_2)
      ).to.be.revertedWithCustomError(registry, "InvalidPubKeyLength");
    });
  });

  describe("transferName", function () {
    beforeEach(async function () {
      await registry.connect(alice).registerName("alice", SPENDING_KEY, VIEWING_KEY, {
        value: REGISTRATION_FEE,
      });
    });

    it("should transfer name ownership", async function () {
      const nameHash = ethers.keccak256(ethers.toUtf8Bytes("alice"));

      await expect(
        registry.connect(alice).transferName("alice", bob.address)
      )
        .to.emit(registry, "NameTransferred")
        .withArgs(nameHash, alice.address, bob.address);

      expect(await registry.nameOwners(nameHash)).to.equal(bob.address);
    });

    it("should clear primary name on transfer", async function () {
      await registry.connect(alice).transferName("alice", bob.address);
      expect(await registry.primaryNames(alice.address)).to.equal(ethers.ZeroHash);
    });

    it("should reject transfer from non-owner", async function () {
      await expect(
        registry.connect(bob).transferName("alice", bob.address)
      ).to.be.revertedWithCustomError(registry, "NotNameOwner");
    });

    it("should reject transfer to zero address", async function () {
      await expect(
        registry.connect(alice).transferName("alice", ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(registry, "TransferToZeroAddress");
    });
  });

  describe("setPrimaryName", function () {
    it("should set primary name for owner", async function () {
      await registry.connect(alice).registerName("first", SPENDING_KEY, VIEWING_KEY, {
        value: REGISTRATION_FEE,
      });
      await registry.connect(alice).registerName("second", SPENDING_KEY, VIEWING_KEY, {
        value: REGISTRATION_FEE,
      });

      const secondHash = ethers.keccak256(ethers.toUtf8Bytes("second"));
      await registry.connect(alice).setPrimaryName("second");
      expect(await registry.primaryNames(alice.address)).to.equal(secondHash);
    });

    it("should reject non-owner setting primary", async function () {
      await registry.connect(alice).registerName("alice", SPENDING_KEY, VIEWING_KEY, {
        value: REGISTRATION_FEE,
      });

      await expect(
        registry.connect(bob).setPrimaryName("alice")
      ).to.be.revertedWithCustomError(registry, "NotNameOwner");
    });
  });

  describe("admin", function () {
    it("should update registration fee", async function () {
      const newFee = ethers.parseEther("0.05");
      await registry.setRegistrationFee(newFee);
      expect(await registry.registrationFee()).to.equal(newFee);
    });

    it("should reject fee update from non-owner", async function () {
      await expect(
        registry.connect(alice).setRegistrationFee(0)
      ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
    });

    it("should withdraw fees", async function () {
      await registry.connect(alice).registerName("fee-test", SPENDING_KEY, VIEWING_KEY, {
        value: REGISTRATION_FEE,
      });

      const balanceBefore = await ethers.provider.getBalance(owner.address);
      const tx = await registry.withdrawFees();
      const receipt = await tx.wait();
      const gasCost = receipt!.gasUsed * receipt!.gasPrice;
      const balanceAfter = await ethers.provider.getBalance(owner.address);

      expect(balanceAfter + gasCost - balanceBefore).to.equal(REGISTRATION_FEE);
    });

    it("should reject withdraw from non-owner", async function () {
      await expect(
        registry.connect(alice).withdrawFees()
      ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
    });

    it("should emit RegistrationFeeUpdated event", async function () {
      const newFee = ethers.parseEther("0.05");
      await expect(registry.setRegistrationFee(newFee))
        .to.emit(registry, "RegistrationFeeUpdated")
        .withArgs(REGISTRATION_FEE, newFee);
    });
  });

  describe("isNameAvailable", function () {
    it("should return true for available name", async function () {
      expect(await registry.isNameAvailable("available")).to.be.true;
    });

    it("should return false for taken name", async function () {
      await registry.connect(alice).registerName("taken", SPENDING_KEY, VIEWING_KEY, {
        value: REGISTRATION_FEE,
      });
      expect(await registry.isNameAvailable("taken")).to.be.false;
    });
  });
});
