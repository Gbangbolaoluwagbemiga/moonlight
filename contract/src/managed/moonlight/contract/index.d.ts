import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export enum OrderStatus { OPEN = 0, ASSIGNED = 1, COMPLETED = 2, CANCELLED = 3 }

export type Witnesses<PS> = {
  localSecretKey(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  postOrder(context: __compactRuntime.CircuitContext<PS>,
            detailsHash_0: Uint8Array,
            budget_0: bigint,
            budgetSalt_0: Uint8Array): __compactRuntime.CircuitResults<PS, bigint>;
  acceptOrder(context: __compactRuntime.CircuitContext<PS>, orderId_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  completeOrder(context: __compactRuntime.CircuitContext<PS>, orderId_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  cancelOrder(context: __compactRuntime.CircuitContext<PS>, orderId_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  verifyBudget(context: __compactRuntime.CircuitContext<PS>,
               orderId_0: bigint,
               budget_0: bigint,
               salt_0: Uint8Array): __compactRuntime.CircuitResults<PS, boolean>;
}

export type ProvableCircuits<PS> = {
  postOrder(context: __compactRuntime.CircuitContext<PS>,
            detailsHash_0: Uint8Array,
            budget_0: bigint,
            budgetSalt_0: Uint8Array): __compactRuntime.CircuitResults<PS, bigint>;
  acceptOrder(context: __compactRuntime.CircuitContext<PS>, orderId_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  completeOrder(context: __compactRuntime.CircuitContext<PS>, orderId_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  cancelOrder(context: __compactRuntime.CircuitContext<PS>, orderId_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  verifyBudget(context: __compactRuntime.CircuitContext<PS>,
               orderId_0: bigint,
               budget_0: bigint,
               salt_0: Uint8Array): __compactRuntime.CircuitResults<PS, boolean>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  postOrder(context: __compactRuntime.CircuitContext<PS>,
            detailsHash_0: Uint8Array,
            budget_0: bigint,
            budgetSalt_0: Uint8Array): __compactRuntime.CircuitResults<PS, bigint>;
  acceptOrder(context: __compactRuntime.CircuitContext<PS>, orderId_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  completeOrder(context: __compactRuntime.CircuitContext<PS>, orderId_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  cancelOrder(context: __compactRuntime.CircuitContext<PS>, orderId_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  verifyBudget(context: __compactRuntime.CircuitContext<PS>,
               orderId_0: bigint,
               budget_0: bigint,
               salt_0: Uint8Array): __compactRuntime.CircuitResults<PS, boolean>;
}

export type Ledger = {
  readonly orderCount: bigint;
  statuses: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: bigint): boolean;
    lookup(key_0: bigint): OrderStatus;
    [Symbol.iterator](): Iterator<[bigint, OrderStatus]>
  };
  clients: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: bigint): boolean;
    lookup(key_0: bigint): Uint8Array;
    [Symbol.iterator](): Iterator<[bigint, Uint8Array]>
  };
  freelancers: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: bigint): boolean;
    lookup(key_0: bigint): Uint8Array;
    [Symbol.iterator](): Iterator<[bigint, Uint8Array]>
  };
  detailCommitments: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: bigint): boolean;
    lookup(key_0: bigint): Uint8Array;
    [Symbol.iterator](): Iterator<[bigint, Uint8Array]>
  };
  budgetCommitments: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: bigint): boolean;
    lookup(key_0: bigint): Uint8Array;
    [Symbol.iterator](): Iterator<[bigint, Uint8Array]>
  };
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
