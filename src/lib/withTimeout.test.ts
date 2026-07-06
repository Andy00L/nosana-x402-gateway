import { describe, expect, test } from "bun:test";
import { withTimeout } from "./withTimeout.js";

const resolveAfter = <ValueType>(value: ValueType, delayMs: number): Promise<ValueType> =>
  new Promise((resolve) => setTimeout(() => resolve(value), delayMs));

const rejectAfter = (message: string, delayMs: number): Promise<never> =>
  new Promise((_resolve, reject) => setTimeout(() => reject(new Error(message)), delayMs));

describe("withTimeout", () => {
  test("returns the value when the operation beats the timeout", async () => {
    const value = await withTimeout(resolveAfter("done", 5), "fast-op", 200);
    expect(value).toBe("done");
  });

  test("rejects with a labelled timeout error when the operation is too slow", async () => {
    const slow = withTimeout(resolveAfter("late", 200), "slow-op", 20);
    await expect(slow).rejects.toThrow("slow-op timed out after 20ms");
  });

  test("propagates the operation's own rejection", async () => {
    const failing = withTimeout(rejectAfter("upstream boom", 5), "failing-op", 200);
    await expect(failing).rejects.toThrow("upstream boom");
  });
});
