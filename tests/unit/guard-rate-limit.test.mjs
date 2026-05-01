// ============================================================
// Guard M2: 速率限制器单元测试
// ============================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RateLimiter } from "../../dist/guard/rate-limit.js";

describe("RateLimiter", () => {
  it("should allow requests within limit", () => {
    const limiter = new RateLimiter(3, 60_000);
    assert.equal(limiter.check("bash", "s1").allowed, true);
    assert.equal(limiter.check("bash", "s1").allowed, true);
    assert.equal(limiter.check("bash", "s1").allowed, true);
  });

  it("should deny when limit exceeded", () => {
    const limiter = new RateLimiter(2, 60_000);
    assert.equal(limiter.check("bash", "s1").allowed, true);
    assert.equal(limiter.check("bash", "s1").allowed, true);
    const result = limiter.check("bash", "s1");
    assert.equal(result.allowed, false);
    assert.ok(result.retryAfterMs > 0);
  });

  it("should track different tools independently", () => {
    const limiter = new RateLimiter(1, 60_000);
    assert.equal(limiter.check("bash", "s1").allowed, true);
    assert.equal(limiter.check("read", "s1").allowed, true);
    assert.equal(limiter.check("bash", "s1").allowed, false);
    assert.equal(limiter.check("read", "s1").allowed, false);
  });

  it("should track different sessions independently", () => {
    const limiter = new RateLimiter(1, 60_000);
    assert.equal(limiter.check("bash", "s1").allowed, true);
    assert.equal(limiter.check("bash", "s2").allowed, true);
    assert.equal(limiter.check("bash", "s1").allowed, false);
    assert.equal(limiter.check("bash", "s2").allowed, false);
  });

  it("should reset specific tool+session", () => {
    const limiter = new RateLimiter(1, 60_000);
    limiter.check("bash", "s1");
    assert.equal(limiter.check("bash", "s1").allowed, false);
    limiter.reset("bash", "s1");
    assert.equal(limiter.check("bash", "s1").allowed, true);
  });

  it("should reset all when no args", () => {
    const limiter = new RateLimiter(1, 60_000);
    limiter.check("bash", "s1");
    limiter.check("read", "s2");
    limiter.reset();
    assert.equal(limiter.check("bash", "s1").allowed, true);
    assert.equal(limiter.check("read", "s2").allowed, true);
  });

  it("should recover after window expires", async () => {
    const limiter = new RateLimiter(1, 100); // 100ms window
    limiter.check("bash", "s1");
    assert.equal(limiter.check("bash", "s1").allowed, false);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(limiter.check("bash", "s1").allowed, true);
  });

  it("should return correct window size", () => {
    const limiter = new RateLimiter(5, 60_000);
    assert.equal(limiter.getWindowSize(), 0);
    limiter.check("bash", "s1");
    assert.equal(limiter.getWindowSize(), 1);
    limiter.check("read", "s1");
    assert.equal(limiter.getWindowSize(), 2);
  });
});
