import { getTelegramBot, TelegramConfigurationError, type TelegramConfig } from "./config";
import {
  type TelegramImageFetchResult,
} from "./types";

export const TELEGRAM_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const TELEGRAM_MEDIA_TIMEOUT_MS = 10_000;

const SUPPORTED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

interface TelegramGetFileResponse {
  readonly ok?: unknown;
  readonly result?: { readonly file_path?: unknown };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeMimeType(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && SUPPORTED_MIME_TYPES.has(normalized) ? normalized : undefined;
}

function validateFilePath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) {
    throw new Error("telegram_file_path_invalid");
  }
  if (
    value.includes("://") || value.includes("\\") || value.includes("..") ||
    /[\u0000-\u001f?#%]/u.test(value) || !/^[A-Za-z0-9._/-]+$/u.test(value)
  ) {
    throw new Error("telegram_file_path_rejected");
  }
  return value;
}

function detectMimeType(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (
    bytes.length >= 6 &&
    ((bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 && bytes[5] === 0x61))
  ) {
    return "image/gif";
  }
  return undefined;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize)));
  }
  return btoa(binary);
}

async function readBoundedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const parsed = Number(contentLength);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > maxBytes) {
      throw new Error("telegram_image_size_rejected");
    }
  }
  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) throw new Error("telegram_image_size_rejected");
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("telegram_image_size_rejected");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export interface TelegramMediaFetcherOptions {
  readonly config: TelegramConfig;
  readonly fetcher?: typeof fetch;
  readonly maxBytes?: number;
}

export class TelegramMediaFetcher {
  private readonly fetcher: typeof fetch;
  private readonly maxBytes: number;

  constructor(private readonly options: TelegramMediaFetcherOptions) {
    this.fetcher = (options.fetcher ?? fetch).bind(globalThis);
    this.maxBytes = options.maxBytes ?? TELEGRAM_IMAGE_MAX_BYTES;
    if (!Number.isInteger(this.maxBytes) || this.maxBytes < 1 || this.maxBytes > TELEGRAM_IMAGE_MAX_BYTES) {
      throw new TelegramConfigurationError(`Telegram image maxBytes must be between 1 and ${TELEGRAM_IMAGE_MAX_BYTES}`);
    }
  }

  async fetchImage(input: {
    readonly fileId: string;
    readonly declaredMimeType?: string;
  }): Promise<TelegramImageFetchResult> {
    const fileId = input.fileId.trim();
    if (fileId.length === 0 || fileId.length > 256 || /[\u0000-\u001f]/u.test(fileId)) {
      return { status: "rejected", errorCategory: "file_id_invalid" };
    }
    const bot = getTelegramBot(this.options.config, "gateway");
    if (!bot?.token) return { status: "unavailable", errorCategory: "gateway_token_unavailable" };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TELEGRAM_MEDIA_TIMEOUT_MS);
    try {
      const getFileResponse = await this.fetcher(
        `https://api.telegram.org/bot${bot.token}/getFile`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ file_id: fileId }),
          signal: controller.signal,
        },
      );
      const getFileBody = await getFileResponse.text();
      if (getFileBody.length > 65_536 || !getFileResponse.ok) {
        return { status: "download_failed", errorCategory: `get_file_http_${getFileResponse.status}` };
      }
      let parsed: TelegramGetFileResponse;
      try {
        parsed = JSON.parse(getFileBody) as TelegramGetFileResponse;
      } catch {
        return { status: "download_failed", errorCategory: "get_file_invalid_json" };
      }
      if (parsed.ok !== true || !isRecord(parsed.result)) {
        return { status: "download_failed", errorCategory: "get_file_rejected" };
      }

      let filePath: string;
      try {
        filePath = validateFilePath(parsed.result.file_path);
      } catch {
        return { status: "rejected", errorCategory: "file_path_rejected" };
      }

      const imageResponse = await this.fetcher(
        `https://api.telegram.org/file/bot${bot.token}/${filePath}`,
        { method: "GET", signal: controller.signal },
      );
      if (!imageResponse.ok) {
        return { status: "download_failed", errorCategory: `download_http_${imageResponse.status}` };
      }
      let bytes: Uint8Array;
      try {
        bytes = await readBoundedBytes(imageResponse, this.maxBytes);
      } catch (error: unknown) {
        return { status: "rejected", errorCategory: String(error).slice(0, 80) };
      }
      const detectedMimeType = detectMimeType(bytes);
      const declaredMimeType = safeMimeType(input.declaredMimeType);
      if (!detectedMimeType || !SUPPORTED_MIME_TYPES.has(detectedMimeType)) {
        return { status: "rejected", errorCategory: "image_magic_bytes_rejected" };
      }
      if (declaredMimeType !== undefined && declaredMimeType !== detectedMimeType) {
        return { status: "rejected", errorCategory: "image_mime_magic_mismatch" };
      }
      return {
        status: "available",
        dataUrl: `data:${detectedMimeType};base64,${toBase64(bytes)}`,
        mimeType: detectedMimeType,
        byteLength: bytes.byteLength,
      };
    } catch (error: unknown) {
      return {
        status: error instanceof DOMException && error.name === "AbortError" ? "download_failed" : "download_failed",
        errorCategory: error instanceof DOMException && error.name === "AbortError" ? "timeout" : "transport_failure",
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
