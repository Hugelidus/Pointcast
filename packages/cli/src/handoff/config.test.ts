import { EXTENSION_ID, HANDOFF_PORT } from "@pointcast/core";
import { describe, expect, it, vi } from "vitest";
import { CliError } from "../errors";
import { allowedExtensionIds, resolveHandoffPort, resolveHandoffSettings } from "./config";

describe("resolveHandoffPort", () => {
  it("receives on HANDOFF_PORT by default", () => {
    expect(resolveHandoffPort(false, {})).toBe(HANDOFF_PORT);
    expect(resolveHandoffPort(false, { POINTCAST_HANDOFF: "on", POINTCAST_HANDOFF_PORT: "" })).toBe(HANDOFF_PORT);
  });

  it("has no receiver with --no-handoff or POINTCAST_HANDOFF=off|0", () => {
    expect(resolveHandoffPort(true, {})).toBeUndefined();
    expect(resolveHandoffPort(true, { POINTCAST_HANDOFF_PORT: "5542" })).toBeUndefined();
    expect(resolveHandoffPort(false, { POINTCAST_HANDOFF: "off" })).toBeUndefined();
    expect(resolveHandoffPort(false, { POINTCAST_HANDOFF: "OFF" })).toBeUndefined();
    expect(resolveHandoffPort(false, { POINTCAST_HANDOFF: "0" })).toBeUndefined();
  });

  it("takes the POINTCAST_HANDOFF_PORT test hook, 0 included (any free port)", () => {
    expect(resolveHandoffPort(false, { POINTCAST_HANDOFF_PORT: "5542" })).toBe(5542);
    expect(resolveHandoffPort(false, { POINTCAST_HANDOFF_PORT: "0" })).toBe(0);
    expect(resolveHandoffPort(false, { POINTCAST_HANDOFF_PORT: "65535" })).toBe(65535);
  });

  it.each(["70000", "65536", "abc", "5542abc", "-1", "1.5", " 5542", "123456"])("rejects POINTCAST_HANDOFF_PORT=%j", (port) => {
    expect(() => resolveHandoffPort(false, { POINTCAST_HANDOFF_PORT: port })).toThrow(CliError);
    expect(() => resolveHandoffPort(false, { POINTCAST_HANDOFF_PORT: port })).toThrow(/POINTCAST_HANDOFF_PORT must be a port number/);
  });
});

describe("allowedExtensionIds", () => {
  const fork = "a".repeat(32);
  const edge = "b".repeat(32);

  it("is the official ids by default", () => {
    expect([...allowedExtensionIds({})]).toEqual([EXTENSION_ID]);
    expect([...allowedExtensionIds({ POINTCAST_EXTENSION_IDS: "" })]).toEqual([EXTENSION_ID]);
  });

  it("adds POINTCAST_EXTENSION_IDS to them, comma-separated and trimmed", () => {
    expect([...allowedExtensionIds({ POINTCAST_EXTENSION_IDS: ` ${fork} ,${edge},, ` })]).toEqual([EXTENSION_ID, fork, edge]);
    expect([...allowedExtensionIds({ POINTCAST_EXTENSION_IDS: EXTENSION_ID })]).toEqual([EXTENSION_ID]);
  });

  it.each(["x".repeat(32), "a".repeat(31), `chrome-extension://${"a".repeat(32)}`, "A".repeat(32)])(
    "rejects %j, naming it",
    (id) => {
      expect(() => allowedExtensionIds({ POINTCAST_EXTENSION_IDS: `${fork},${id}` })).toThrow(CliError);
      expect(() => allowedExtensionIds({ POINTCAST_EXTENSION_IDS: `${fork},${id}` })).toThrow(`"${id}" is not an extension id`);
    },
  );
});

describe("resolveHandoffSettings", () => {
  const fork = "a".repeat(32);

  it("reads the port and the ids when the receiver is on", () => {
    const log = vi.fn();
    const settings = resolveHandoffSettings(false, { POINTCAST_HANDOFF_PORT: "0", POINTCAST_EXTENSION_IDS: fork }, log);
    expect(settings.port).toBe(0);
    expect([...settings.allowedExtensionIds]).toEqual([EXTENSION_ID, fork]);
    expect(log).not.toHaveBeenCalled();
  });

  it("ignores a malformed environment when the receiver is off", () => {
    const log = vi.fn();
    const env = { POINTCAST_HANDOFF_PORT: "abc", POINTCAST_EXTENSION_IDS: "A".repeat(32) };
    expect(resolveHandoffSettings(true, env, log).port).toBeUndefined();
    expect(resolveHandoffSettings(false, { ...env, POINTCAST_HANDOFF: "off" }, log).port).toBeUndefined();
    expect(log).not.toHaveBeenCalled();
  });

  it.each([
    [{ POINTCAST_EXTENSION_IDS: "A".repeat(32) }, /POINTCAST_EXTENSION_IDS/],
    [{ POINTCAST_HANDOFF_PORT: "5542abc" }, /POINTCAST_HANDOFF_PORT/],
  ])("turns the receiver off, with a log line, instead of throwing for %j", (env, pattern) => {
    const log = vi.fn();
    const settings = resolveHandoffSettings(false, env, log);
    expect(settings.port).toBeUndefined();
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]![0]).toMatch(pattern);
    expect(log.mock.calls[0]![0]).toMatch(/Not receiving recordings/);
  });
});
