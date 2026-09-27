import { describe, expect, it, vi } from "vitest";
import { CliError } from "../errors";
import { OpenAiTranscriptionEngine } from "./openai";

// D1 / conventions: "no network in tests" — every test below injects a fake fetch and never
// touches the real network, even though the engine defaults to https://api.openai.com/v1.

function samples(): Float32Array {
  return new Float32Array([0, 0.1, -0.1, 0.2]);
}

describe("OpenAiTranscriptionEngine — request building", () => {
  it("posts multipart form data to {baseUrl}/audio/transcriptions with the expected fields", async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(JSON.stringify({ text: "hello", words: [] }), { status: 200 });
    });

    const engine = new OpenAiTranscriptionEngine({
      baseUrl: "https://example.test/v1",
      apiKey: "sk-test-123",
      model: "whisper-1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await engine.transcribe(samples(), { language: "es", prompt: "Export button" });

    expect(capturedUrl).toBe("https://example.test/v1/audio/transcriptions");
    expect(capturedInit?.method).toBe("POST");
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-test-123");

    const form = capturedInit?.body as FormData;
    expect(form.get("model")).toBe("whisper-1");
    expect(form.get("response_format")).toBe("verbose_json");
    expect(form.getAll("timestamp_granularities[]")).toEqual(["word"]);
    expect(form.get("language")).toBe("es");
    expect(form.get("prompt")).toBe("Export button");
    const file = form.get("file") as File;
    expect(file).toBeInstanceOf(Blob);
    expect(file.type).toBe("audio/wav");
  });

  it("strips trailing slashes from a custom baseUrl", async () => {
    let capturedUrl: string | undefined;
    const fetchImpl = vi.fn(async (url: string | URL) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({ text: "", words: [] }), { status: 200 });
    });
    const engine = new OpenAiTranscriptionEngine({
      baseUrl: "https://example.test/v1///",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await engine.transcribe(samples(), {});
    expect(capturedUrl).toBe("https://example.test/v1/audio/transcriptions");
  });

  it("omits language/prompt fields and Authorization header when not provided", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      capturedInit = init;
      return new Response(JSON.stringify({ text: "", words: [] }), { status: 200 });
    });
    // An empty injected env: no ambient OPENAI_API_KEY can leak into this assertion.
    const engine = new OpenAiTranscriptionEngine({ fetchImpl: fetchImpl as unknown as typeof fetch, env: {} });

    await engine.transcribe(samples(), {});

    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    const form = capturedInit?.body as FormData;
    expect(form.get("language")).toBeNull();
    expect(form.get("prompt")).toBeNull();
  });
});

describe("OpenAiTranscriptionEngine — where the key and audio may go", () => {
  const authorizationSentTo = async (env: Record<string, string>): Promise<string | undefined> => {
    let headers: Record<string, string> = {};
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      headers = init?.headers as Record<string, string>;
      return new Response(JSON.stringify({ text: "", words: [] }), { status: 200 });
    });
    await new OpenAiTranscriptionEngine({ fetchImpl: fetchImpl as unknown as typeof fetch, env }).transcribe(samples(), {});
    return headers.Authorization;
  };

  it("uses OPENAI_API_KEY for OpenAI's own endpoint", async () => {
    expect(await authorizationSentTo({ OPENAI_API_KEY: "sk-openai" })).toBe("Bearer sk-openai");
  });

  it("never sends OPENAI_API_KEY to another server named by POINTCAST_API_BASE", async () => {
    expect(
      await authorizationSentTo({ OPENAI_API_KEY: "sk-openai", POINTCAST_API_BASE: "https://api.groq.com/openai/v1" }),
    ).toBeUndefined();
  });

  it("uses POINTCAST_API_KEY for any server", async () => {
    expect(
      await authorizationSentTo({
        OPENAI_API_KEY: "sk-openai",
        POINTCAST_API_KEY: "gsk-groq",
        POINTCAST_API_BASE: "https://api.groq.com/openai/v1",
      }),
    ).toBe("Bearer gsk-groq");
  });

  it("refuses plain http to another machine, before anything is sent", () => {
    for (const baseUrl of ["http://192.168.1.20:8000/v1", "http://whisper.example.com/v1"]) {
      expect(() => new OpenAiTranscriptionEngine({ baseUrl, env: {} })).toThrow(CliError);
    }
  });

  it("accepts plain http to a server on this machine", () => {
    for (const baseUrl of ["http://localhost:8000/v1", "http://127.0.0.1:8000/v1", "http://[::1]:8000/v1"]) {
      expect(() => new OpenAiTranscriptionEngine({ baseUrl, env: {} })).not.toThrow();
    }
  });

  it("rejects a base URL that is not a URL", () => {
    expect(() => new OpenAiTranscriptionEngine({ env: { POINTCAST_API_BASE: "api.groq.com" } })).toThrow(/not a valid URL/);
  });
});

describe("OpenAiTranscriptionEngine — response mapping", () => {
  it("maps verbose_json word timestamps (seconds) into WordsFile (integer ms)", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          text: "Esto es una prueba.",
          language: "spanish",
          words: [
            { word: "Esto", start: 1.975, end: 2.293 },
            { word: "es", start: 2.3, end: 2.45 },
          ],
        }),
        { status: 200 },
      ),
    );
    const engine = new OpenAiTranscriptionEngine({ model: "whisper-1", fetchImpl: fetchImpl as unknown as typeof fetch, env: {} });

    const result = await engine.transcribe(samples(), { language: "es" });

    expect(result.schemaVersion).toBe(1);
    expect(result.engine).toBe("openai:whisper-1");
    expect(result.language).toBe("spanish");
    expect(result.words).toEqual([
      { text: "Esto", start: 1975, end: 2293 },
      { text: "es", start: 2300, end: 2450 },
    ]);
  });

  it("falls back to the requested language when the response omits one", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ text: "hi", words: [] }), { status: 200 }));
    const engine = new OpenAiTranscriptionEngine({ fetchImpl: fetchImpl as unknown as typeof fetch, env: {} });
    const result = await engine.transcribe(samples(), { language: "en" });
    expect(result.language).toBe("en");
  });

  it("throws a descriptive error on a non-2xx response", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("invalid api key", { status: 401, statusText: "Unauthorized" }),
    );
    const engine = new OpenAiTranscriptionEngine({ fetchImpl: fetchImpl as unknown as typeof fetch, env: {} });
    await expect(engine.transcribe(samples(), {})).rejects.toThrow(/401.*Unauthorized.*invalid api key/s);
  });
});
