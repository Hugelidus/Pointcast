import { describe, expect, it, vi } from "vitest";
import type { RecorderState } from "../recorder-state";
import type { StoredChanges } from "../state-store";

const fake = vi.hoisted(() => ({
  /** Answers the pending get-state request. */
  answer: undefined as ((state: RecorderState) => void) | undefined,
  storageListener: undefined as ((changes: StoredChanges) => void) | undefined,
}));

vi.mock("../messages", () => ({
  sendMessage: () => new Promise<RecorderState>((resolve) => (fake.answer = resolve)),
}));
vi.mock("../state-store", () => ({
  watchStore: (listener: (changes: StoredChanges) => void) => {
    fake.storageListener = listener;
    return () => (fake.storageListener = undefined);
  },
}));

const { followState } = await import("./recorder-link");

describe("followState", () => {
  it("follows the initial answer and later changes", async () => {
    const onChange = vi.fn();
    followState(onChange);
    fake.answer?.({ status: "recording", t0: 1 });
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith({ status: "recording", t0: 1 }));
    fake.storageListener?.({ state: { status: "idle" } });
    expect(onChange.mock.calls).toEqual([[{ status: "recording", t0: 1 }], [{ status: "idle" }]]);
  });

  it("drops an initial answer older than a change already seen", async () => {
    const onChange = vi.fn();
    followState(onChange);
    fake.storageListener?.({ state: { status: "processing" } });
    fake.answer?.({ status: "recording", t0: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onChange.mock.calls).toEqual([[{ status: "processing" }]]);
  });

  it("ignores an answer that arrives after unsubscribing (a copy replaced by a newer one)", async () => {
    const onChange = vi.fn();
    const unfollow = followState(onChange);
    const answer = fake.answer;
    unfollow();
    answer?.({ status: "recording", t0: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onChange).not.toHaveBeenCalled();
    expect(fake.storageListener).toBeUndefined();
  });
});
