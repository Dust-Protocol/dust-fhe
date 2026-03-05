import { describe, it, expect, vi } from "vitest";
import { ShieldedEvmFacilitatorScheme } from "../src/facilitator/scheme";

describe("ShieldedEvmFacilitatorScheme", () => {
  const mockSigner = {
    getAddresses: () =>
      ["0x8d56E94a02F06320BDc68FAfE23DEc9Ad7463496" as `0x${string}`],
    readContract: vi.fn(),
    writeContract: vi
      .fn()
      .mockResolvedValue("0xtxhash" as `0x${string}`),
    waitForTransactionReceipt: vi
      .fn()
      .mockResolvedValue({ status: "success" }),
    verifyTypedData: vi.fn(),
    sendTransaction: vi.fn(),
    getCode: vi.fn(),
  };

  it("should have scheme 'shielded' and caipFamily 'eip155:*'", () => {
    const scheme = new ShieldedEvmFacilitatorScheme(mockSigner, {
      poolAddresses: {
        "eip155:84532": "0x17f52f01ffcB6d3C376b2b789314808981cebb16",
      },
    });
    expect(scheme.scheme).toBe("shielded");
    expect(scheme.caipFamily).toBe("eip155:*");
  });

  it("should return pool address in getExtra", () => {
    const scheme = new ShieldedEvmFacilitatorScheme(mockSigner, {
      poolAddresses: {
        "eip155:84532": "0x17f52f01ffcB6d3C376b2b789314808981cebb16",
      },
      treeServiceUrl: "http://localhost:3001/tree",
    });
    const extra = scheme.getExtra("eip155:84532");
    expect(extra).toBeDefined();
    expect((extra as Record<string, unknown>).dustPoolV2).toBe(
      "0x17f52f01ffcB6d3C376b2b789314808981cebb16",
    );
  });

  it("should return signer addresses", () => {
    const scheme = new ShieldedEvmFacilitatorScheme(mockSigner, {
      poolAddresses: {
        "eip155:84532": "0x17f52f01ffcB6d3C376b2b789314808981cebb16",
      },
    });
    expect(scheme.getSigners("eip155:84532")).toEqual([
      "0x8d56E94a02F06320BDc68FAfE23DEc9Ad7463496",
    ]);
  });

  it("should reject verify when nullifier is already spent", async () => {
    mockSigner.readContract
      .mockResolvedValueOnce(true) // verifyProof = true (FFLONK verifier)
      .mockResolvedValueOnce(true) // isKnownRoot = true
      .mockResolvedValueOnce(true); // nullifiers(nullifier0) = true (already spent)

    const scheme = new ShieldedEvmFacilitatorScheme(mockSigner, {
      poolAddresses: {
        "eip155:84532": "0x17f52f01ffcB6d3C376b2b789314808981cebb16",
      },
    });

    const payload = {
      x402Version: 2,
      resource: { url: "", description: "", mimeType: "" },
      accepted: {},
      payload: {
        proof: ("0x" + "ab".repeat(384)) as `0x${string}`,
        publicSignals: {
          merkleRoot: "12345",
          nullifier0: "67890",
          nullifier1: "0",
          outputCommitment0: "11111",
          outputCommitment1: "22222",
          publicAmount: (21888242871839275222246405745257275088548364400416034343698204186575808495617n - 1000000n).toString(),
          publicAsset: "33333",
          recipient: BigInt("0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0").toString(),
          chainId: "84532",
        },
      },
    };

    const requirements = {
      scheme: "shielded" as const,
      network: "eip155:84532" as const,
      amount: "1000000",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      payTo: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
      maxTimeoutSeconds: 300,
      extra: {},
    };

    const result = await scheme.verify(payload as unknown as Parameters<typeof scheme.verify>[0], requirements);
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toContain("nullifier");
  });
});
