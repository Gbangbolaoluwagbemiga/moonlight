import type { WitnessContext } from "@midnight-ntwrk/compact-runtime";
import type { Ledger } from "./managed/oru/contract/index.js";

/**
 * Private state held locally by each Oru participant. The secret key
 * never leaves the user's machine; circuits derive a public identity hash
 * from it in-circuit.
 */
export type OruPrivateState = {
  readonly secretKey: Uint8Array;
};

export const createOruPrivateState = (
  secretKey: Uint8Array
): OruPrivateState => ({ secretKey });

export const witnesses = {
  localSecretKey: ({
    privateState
  }: WitnessContext<Ledger, OruPrivateState>): [
    OruPrivateState,
    Uint8Array
  ] => [privateState, privateState.secretKey]
};
