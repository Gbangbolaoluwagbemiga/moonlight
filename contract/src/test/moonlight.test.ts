import { createHash } from "node:crypto";
import { TextEncoder } from "node:util";
import { describe, it, expect } from "vitest";
import { setNetworkId } from "@midnight-ntwrk/midnight-js/network-id";
import { OrderStatus } from "../managed/moonlight/contract/index.js";
import { MoonlightSimulator } from "./moonlight-simulator.js";

setNetworkId("undeployed");

const CLIENT = MoonlightSimulator.actorKey(1);
const FREELANCER = MoonlightSimulator.actorKey(2);

const detailsHash = new Uint8Array(32).fill(7);
const budget = 500n;
const budgetSalt = new Uint8Array(32).fill(9);

const postSampleOrder = (sim: MoonlightSimulator): bigint =>
  sim.as(CLIENT).postOrder(detailsHash, budget, budgetSalt);

describe("Moonlight work-order contract", () => {
  it("starts with an empty order book", () => {
    const sim = new MoonlightSimulator();
    const state = sim.getLedger();
    expect(state.orderCount).toEqual(0n);
    expect(state.statuses.isEmpty()).toBe(true);
  });

  it("posts an order: status public, details and budget only as commitments", () => {
    const sim = new MoonlightSimulator();
    const id = postSampleOrder(sim);
    expect(id).toEqual(0n);

    const state = sim.getLedger();
    expect(state.orderCount).toEqual(1n);
    expect(state.statuses.lookup(id)).toEqual(OrderStatus.OPEN);
    // Details are stored as the supplied commitment, not plaintext.
    expect(state.detailCommitments.lookup(id)).toEqual(detailsHash);
    // The budget commitment is a hash; the raw amount (500) appears nowhere.
    expect(state.budgetCommitments.lookup(id)).toHaveLength(32);
    // The client is stored as an identity hash, not a raw key or address.
    expect(state.clients.lookup(id)).not.toEqual(CLIENT);
  });

  it("assigns sequential ids", () => {
    const sim = new MoonlightSimulator();
    expect(postSampleOrder(sim)).toEqual(0n);
    expect(postSampleOrder(sim)).toEqual(1n);
    expect(sim.getLedger().orderCount).toEqual(2n);
  });

  it("lets a freelancer accept an open order", () => {
    const sim = new MoonlightSimulator();
    const id = postSampleOrder(sim);
    sim.as(FREELANCER).acceptOrder(id);

    const state = sim.getLedger();
    expect(state.statuses.lookup(id)).toEqual(OrderStatus.ASSIGNED);
    expect(state.freelancers.member(id)).toBe(true);
    expect(state.freelancers.lookup(id)).not.toEqual(state.clients.lookup(id));
  });

  it("rejects a client accepting their own order", () => {
    const sim = new MoonlightSimulator();
    const id = postSampleOrder(sim);
    expect(() => sim.as(CLIENT).acceptOrder(id)).toThrow(
      /Client cannot accept their own order/
    );
  });

  it("rejects accepting a non-existent or non-open order", () => {
    const sim = new MoonlightSimulator();
    expect(() => sim.as(FREELANCER).acceptOrder(42n)).toThrow(/does not exist/);
    const id = postSampleOrder(sim);
    sim.as(FREELANCER).acceptOrder(id);
    expect(() => sim.as(MoonlightSimulator.actorKey(3)).acceptOrder(id)).toThrow(
      /not open/
    );
  });

  it("lets only the client complete an assigned order", () => {
    const sim = new MoonlightSimulator();
    const id = postSampleOrder(sim);
    sim.as(FREELANCER).acceptOrder(id);

    expect(() => sim.as(FREELANCER).completeOrder(id)).toThrow(
      /Only the client/
    );
    sim.as(CLIENT).completeOrder(id);
    expect(sim.getLedger().statuses.lookup(id)).toEqual(OrderStatus.COMPLETED);
  });

  it("lets the client cancel only while the order is open", () => {
    const sim = new MoonlightSimulator();
    const id = postSampleOrder(sim);
    expect(() => sim.as(FREELANCER).cancelOrder(id)).toThrow(/Only the client/);
    sim.as(CLIENT).cancelOrder(id);
    expect(sim.getLedger().statuses.lookup(id)).toEqual(OrderStatus.CANCELLED);

    const id2 = postSampleOrder(sim);
    sim.as(FREELANCER).acceptOrder(id2);
    expect(() => sim.as(CLIENT).cancelOrder(id2)).toThrow(/open/);
  });

  it("never exposes raw private inputs in the public ledger state", () => {
    const sim = new MoonlightSimulator();
    const details = "Design a landing page for a Lagos fintech, 2 week turnaround";
    const detailsPlaintext = new TextEncoder().encode(details);
    const detailsCommitment = new Uint8Array(
      createHash("sha256").update(details, "utf8").digest()
    );
    const secretBudget = 750n;
    const salt = new Uint8Array(32).fill(3);

    const id = sim.as(CLIENT).postOrder(detailsCommitment, secretBudget, salt);
    sim.as(FREELANCER).acceptOrder(id);
    const state = sim.getLedger();

    // Collect every byte value the public ledger stores for this order.
    const publicValues: Uint8Array[] = [
      state.clients.lookup(id),
      state.freelancers.lookup(id),
      state.detailCommitments.lookup(id),
      state.budgetCommitments.lookup(id)
    ];

    // Encodings of the private inputs that must never appear on-chain.
    const budgetBytes = new Uint8Array(8);
    new DataView(budgetBytes.buffer).setBigUint64(0, secretBudget);
    const privateValues = [CLIENT, FREELANCER, salt, detailsPlaintext, budgetBytes];

    const contains = (haystack: Uint8Array, needle: Uint8Array): boolean => {
      if (needle.length === 0 || needle.length > haystack.length) return false;
      outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
        for (let j = 0; j < needle.length; j++) {
          if (haystack[i + j] !== needle[j]) continue outer;
        }
        return true;
      }
      return false;
    };

    for (const stored of publicValues) {
      for (const secret of privateValues) {
        expect(contains(stored, secret)).toBe(false);
      }
    }

    // The details commitment is the hash the client supplied — never the text.
    expect(state.detailCommitments.lookup(id)).toEqual(detailsCommitment);
  });

  it("verifies the committed budget without revealing it on-chain", () => {
    const sim = new MoonlightSimulator();
    const id = postSampleOrder(sim);
    expect(sim.verifyBudget(id, budget, budgetSalt)).toBe(true);
    expect(sim.verifyBudget(id, 501n, budgetSalt)).toBe(false);
    expect(sim.verifyBudget(id, budget, new Uint8Array(32).fill(1))).toBe(false);
  });
});
