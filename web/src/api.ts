import type {
  Anchor, DocumentInfo, EditResponse, FindHit, FindReplaceResponse, Fit, PageModel,
} from "./types";

const BASE = "/api/v1";

export class ApiError extends Error {
  constructor(message: string, public status: number, public body?: any) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, init);
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    throw new ApiError(body?.message ?? `Request failed (${res.status})`, res.status, body);
  }
  return body.data as T;
}

const json = (data: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});

export interface SessionInfo {
  multiUser: boolean;
  retentionHours: number | null;
  accountRetentionDays: number | null;
  maxUploadMb: number;
  trashDays: number | null;
  user: { phone: string } | null;
}

export const api = {
  // accounts (hosted website only)
  session: () => call<SessionInfo>("/session"),
  sendCode: (phone: string) => call<{ phone: string; resendSeconds: number; expiresMinutes: number }>("/auth/code", json({ phone })),
  verifyCode: (phone: string, code: string) => call<SessionInfo & { movedDocuments: number }>("/auth/verify", json({ phone, code })),
  logout: () => call<SessionInfo>("/auth/logout", { method: "POST" }),
  deleteAccount: () => call<SessionInfo & { deletedDocuments: number }>("/auth/account", { method: "DELETE" }),

  list: () => call<DocumentInfo[]>("/documents"),
  get: (id: string) => call<DocumentInfo>(`/documents/${id}`),
  remove: (id: string) => call<null>(`/documents/${id}`, { method: "DELETE" }),
  trash: () => call<(DocumentInfo & { deleted_at: string })[]>("/trash"),
  restore: (id: string) => call<DocumentInfo>(`/trash/${id}/restore`, { method: "POST" }),
  erase: (id: string) => call<null>(`/trash/${id}`, { method: "DELETE" }),
  upload: (file: File, password = "") => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("password", password);
    return call<DocumentInfo>("/documents", { method: "POST", body: fd });
  },
  fromImages: (files: File[]) => {
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    return call<DocumentInfo>("/documents/from-images", { method: "POST", body: fd });
  },
  fileUrl: (id: string, version?: number) =>
    `${BASE}/documents/${id}/file${version !== undefined ? `?version=${version}` : ""}`,
  downloadUrl: (id: string) => `${BASE}/documents/${id}/download`,
  renderUrl: (id: string, page: number, version: number, zoom: number) =>
    `${BASE}/documents/${id}/pages/${page}/render.png?version=${version}&zoom=${zoom}`,
  compareUrl: (id: string, page: number, a: number, b: number) =>
    `${BASE}/documents/${id}/compare/${page}.png?a=${a}&b=${b}`,
  page: (id: string, page: number, version?: number) =>
    call<PageModel>(`/documents/${id}/pages/${page}/text${version !== undefined ? `?version=${version}` : ""}`),
  replace: (
    id: string,
    body: { page: number; baseVersion: number; dryRun: boolean; edits: { glyphs: number[]; text: string; anchor: Anchor; fit: Fit; style?: { family: string; bold: boolean } }[] },
    signal?: AbortSignal,
  ) => call<EditResponse>(`/documents/${id}/edit/replace-text`, { ...json(body), signal }),
  find: (id: string, query: string, matchCase: boolean, wholeWord: boolean) =>
    call<FindHit[]>(`/documents/${id}/find`, json({ query, matchCase, wholeWord })),
  findReplace: (
    id: string,
    body: { query: string; replacement: string; matchCase: boolean; wholeWord: boolean; anchor: Anchor; fit: Fit; baseVersion: number; dryRun: boolean },
  ) => call<FindReplaceResponse>(`/documents/${id}/edit/find-replace`, json(body)),
  undo: (id: string) => call<DocumentInfo>(`/documents/${id}/undo`, { method: "POST" }),
  redo: (id: string) => call<DocumentInfo>(`/documents/${id}/redo`, { method: "POST" }),

  // pages
  pageOp: (id: string, body: { op: string; pages?: number[]; degrees?: number; from?: number; to?: number; after?: number; baseVersion: number }) =>
    call<DocumentInfo>(`/documents/${id}/pages`, json(body)),
  merge: (id: string, file: File, after: number, baseVersion: number, password = "") => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("after", String(after));
    fd.append("baseVersion", String(baseVersion));
    fd.append("password", password);
    return call<DocumentInfo>(`/documents/${id}/merge`, { method: "POST", body: fd });
  },
  extract: (id: string, pages: string, splitEach: boolean) =>
    call<DocumentInfo[]>(`/documents/${id}/extract`, json({ pages, splitEach })),

  // export with optional password protection; returns a Blob to save
  compressionOptions: (id: string) => call<Record<CompressionLevel, CompressionStats>>(`/documents/${id}/compression`),
  exportPdf: async (id: string, body: ExportOptions) => {
    const res = await fetch(`${BASE}/documents/${id}/export`, json(body));
    if (!res.ok) {
      const b = await res.json().catch(() => null);
      throw new ApiError(b?.message ?? `Export failed (${res.status})`, res.status, b);
    }
    const cd = res.headers.get("content-disposition") ?? "";
    const m = /filename\*=UTF-8''([^;]+)/.exec(cd);
    return {
      blob: await res.blob(), name: m ? decodeURIComponent(m[1]) : "document.pdf",
      originalSize: Number(res.headers.get("x-original-size") ?? 0), size: Number(res.headers.get("x-compressed-size") ?? 0),
    };
  },

  convert: async (id: string, format: ConvertFormat, pages: string, dpi: number) => {
    const q = new URLSearchParams({ format, pages, dpi: String(dpi) });
    const res = await fetch(`${BASE}/documents/${id}/convert?${q}`);
    if (!res.ok) {
      const b = await res.json().catch(() => null);
      throw new ApiError(b?.message ?? `Download failed (${res.status})`, res.status, b);
    }
    const cd = res.headers.get("content-disposition") ?? "";
    const m = /filename\*=UTF-8''([^;]+)/.exec(cd);
    const noText = (res.headers.get("x-pages-without-text") ?? "").split(",").filter(Boolean).map(Number);
    return { blob: await res.blob(), name: m ? decodeURIComponent(m[1]) : `document.${format}`, noText };
  },

  // annotations
  annotations: (id: string, page: number) => call<AnnotationInfo[]>(`/documents/${id}/pages/${page}/annotations`),
  annotate: (id: string, body: Record<string, unknown> & { page: number; type: string; baseVersion: number }) =>
    call<DocumentInfo>(`/documents/${id}/annotations`, json(body)),
  imageOp: (id: string, page: number, body: ImageOp) =>
    call<DocumentInfo & { notes?: { warnings?: string[]; bbox?: number[] } }>(`/documents/${id}/pages/${page}/images`, json(body)),
  deleteAnnotation: (id: string, page: number, nm: string, baseVersion: number) =>
    call<DocumentInfo>(`/documents/${id}/pages/${page}/annotations/${encodeURIComponent(nm)}?baseVersion=${baseVersion}`, { method: "DELETE" }),
  watermark: (id: string, body: { text?: string; opacity?: number; color?: string; remove?: boolean; baseVersion: number }) =>
    call<DocumentInfo>(`/documents/${id}/watermark`, json(body)),

  // OCR
  ocrStatus: () => call<{ available: boolean; languages: string[] }>("/ocr/status"),
  startOcr: (id: string, pages?: number[], langs = "eng+hin") => call<JobInfo>(`/documents/${id}/ocr`, json({ pages, langs })),
  job: (jobId: string) => call<JobInfo>(`/jobs/${jobId}`),
  textLayer: (id: string, baseVersion: number) => call<DocumentInfo>(`/documents/${id}/ocr/text-layer`, json({ baseVersion })),

  // AI assistant
  chat: (id: string, message: string, conversationId?: string) =>
    call<{ conversationId: string; reply: string; actions: ChatAction[]; version: number; changed: boolean }>(
      `/documents/${id}/assistant`, json({ message, conversationId })),
  check: (id: string) => call<CheckResult>(`/documents/${id}/check`),
  resetChat: (conversationId: string) => call<null>(`/assistant/${conversationId}`, { method: "DELETE" }),
};

export interface ChatAction {
  tool: string;
  summary: string;
  ok: boolean;
}

export interface AnnotationInfo {
  id: string | null;
  type: string;
  rect: [number, number, number, number];
  contents: string;
  author: string;
  color: string | null;
  ours: boolean;
}

export interface JobInfo {
  id: string;
  status: "QUEUED" | "RUNNING" | "DONE" | "FAILED";
  progress: number;
  error: string | null;
  result: { pages: number[] } | null;
}

export type ConvertFormat = "jpg" | "png" | "docx" | "xlsx" | "txt";

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export type IssueSeverity = "error" | "warning" | "info";
export type IssueCategory = "text" | "layout" | "scan" | "structure" | "editing";

export interface CheckIssue {
  id: string;
  category: IssueCategory;
  severity: IssueSeverity;
  page: number | null;
  title: string;
  detail: string;
  fix: string;
  boxes: number[][];
}

export interface CheckResult {
  pages: number;
  version: number;
  issues: CheckIssue[];
  summary: Record<IssueSeverity, number>;
}

export type CompressionLevel = "none" | "lossless" | "balanced" | "strong";

export interface CompressionStats {
  level: CompressionLevel;
  originalSize: number;
  size: number;
  saved: number;
  savedPercent: number;
  imagesRecompressed: number;
}

export interface ExportOptions {
  userPassword: string;
  ownerPassword: string;
  allowPrint: boolean;
  allowCopy: boolean;
  allowModify: boolean;
  allowAnnotate: boolean;
  compression: CompressionLevel;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export type ImageOp =
  | { action: "insert"; rect: number[]; image: string; fit?: "contain" | "stretch"; baseVersion: number }
  | { action: "transform"; index: number; bbox?: number[]; rotate?: number; baseVersion: number }
  | { action: "delete"; index: number; baseVersion: number }
  | { action: "replace"; index: number; image: string; fit?: "contain" | "stretch"; baseVersion: number };

/** An image operation without the version, which the editor adds. */
export type ImageOpBody = ImageOp extends infer T ? (T extends { baseVersion: number } ? Omit<T, "baseVersion"> : never) : never;
