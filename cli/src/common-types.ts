import { Oru, type OruPrivateState } from '@oru/contract';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js/types';
import type { DeployedContract, FoundContract } from '@midnight-ntwrk/midnight-js/contracts';
import type { ProvableCircuitId } from '@midnight-ntwrk/compact-js';

export type OruCircuits = ProvableCircuitId<Oru.Contract<OruPrivateState>>;

export const OruPrivateStateId = 'oruPrivateState';

export type OruProviders = MidnightProviders<
  OruCircuits,
  typeof OruPrivateStateId,
  OruPrivateState
>;

export type OruContract = Oru.Contract<OruPrivateState>;

export type DeployedOruContract = DeployedContract<OruContract> | FoundContract<OruContract>;
