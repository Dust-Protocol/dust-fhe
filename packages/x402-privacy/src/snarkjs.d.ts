declare module "snarkjs" {
  export const fflonk: {
    fullProve(
      input: Record<string, unknown>,
      wasmPath: string,
      zkeyPath: string,
    ): Promise<{ proof: unknown; publicSignals: string[] }>;
    verify(
      vkey: unknown,
      publicSignals: string[],
      proof: unknown,
    ): Promise<boolean>;
    exportSolidityCallData(
      publicSignals: string[],
      proof: unknown,
    ): Promise<string>;
  };
}
