import * as path from "node:path";
import * as vscode from "vscode";
import type { HistoryService } from "../services/historyService";
import type { SessionAnnotationStore } from "../services/sessionAnnotationStore";
import type { ProjectAssociationStore } from "../services/projectAssociationStore";
import type { SessionSummary } from "../sessions/sessionTypes";
import { renderTranscript } from "./transcriptRenderer";
import { t } from "../i18n";
import { resolveDateTimeSettings } from "../utils/dateTimeSettings";
import { normalizeCacheKey } from "../utils/fsUtils";
import { buildTranscriptDocumentFileName } from "./transcriptDocumentName";

// TextDocumentContentProvider that exposes a JSONL session as a Markdown transcript.
export class TranscriptContentProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  public readonly scheme = "codex-history-viewer";

  private readonly historyService: HistoryService;
  private readonly annotationStore: SessionAnnotationStore;
  private readonly projectAssociationStore: ProjectAssociationStore;
  private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChange = this.onDidChangeEmitter.event;

  private readonly cache = new Map<string, { content: string; messageLineMap: Map<number, number> }>();

  constructor(
    historyService: HistoryService,
    annotationStore: SessionAnnotationStore,
    projectAssociationStore: ProjectAssociationStore,
  ) {
    this.historyService = historyService;
    this.annotationStore = annotationStore;
    this.projectAssociationStore = projectAssociationStore;
  }

  public async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const session = this.resolveSessionFromUri(uri);
    if (!session) return "";

    const isClean = new URLSearchParams(uri.query).get("clean") === "1";
    const baseKey = normalizeCacheKey(session.fsPath);
    const key = isClean ? `${baseKey}:clean` : baseKey;
    const cached = this.cache.get(key);
    if (cached) return cached.content;

    const rendered = await this.renderSession(session, isClean);
    this.cache.set(key, rendered);
    return rendered.content;
  }

  public async openSessionTranscript(
    session: SessionSummary,
    options: { preview: boolean; revealMessageIndex?: number; cleanQaOnly?: boolean } = { preview: true },
  ): Promise<void> {
    try {
      const isClean = options.cleanQaOnly === true;
      const uri = this.resolveOpenUri(session, isClean);
      const rendered = await this.renderSession(session, isClean);
      const cacheKey = isClean ? `${normalizeCacheKey(session.fsPath)}:clean` : normalizeCacheKey(session.fsPath);
      this.cache.set(cacheKey, rendered);
      this.onDidChangeEmitter.fire(uri);

      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc, {
        preview: options.preview,
        preserveFocus: options.preview,
      });
      if (doc.languageId !== "markdown") {
        await vscode.languages.setTextDocumentLanguage(doc, "markdown");
      }

      if (options.revealMessageIndex) {
        const line = rendered.messageLineMap.get(options.revealMessageIndex);
        if (typeof line === "number") {
          const pos = new vscode.Position(Math.max(0, line - 1), 0);
          editor.selection = new vscode.Selection(pos, pos);
          await editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        }
      }
    } catch {
      void vscode.window.showErrorMessage(t("app.openSessionFailed"));
    }
  }

  public releaseDocument(uri: vscode.Uri): void {
    if (!isTranscriptDocumentUri(uri, this.scheme)) return;
    const fsPath = getSessionFsPathFromUri(uri);
    if (fsPath) {
      const baseKey = normalizeCacheKey(fsPath);
      this.cache.delete(baseKey);
      this.cache.delete(`${baseKey}:clean`);
    }
  }

  public dispose(): void {
    this.cache.clear();
    this.onDidChangeEmitter.dispose();
  }

  private async renderSession(
    session: SessionSummary,
    cleanQaOnly = false,
  ): Promise<{ content: string; messageLineMap: Map<number, number> }> {
    const { timeZone } = resolveDateTimeSettings();
    const ann = this.annotationStore.get(session.fsPath);
    const displayCwd =
      typeof session.meta?.cwd === "string" ? this.projectAssociationStore.getDisplayCwd(session.meta.cwd) : null;
    return renderTranscript(session.fsPath, {
      timeZone,
      cleanQaOnly,
      title: session.displayTitle,
      locationLabel:
        session.storage.archiveState === "archived" ? t("session.location.archived") : t("session.location.active"),
      displayCwd,
      annotation: {
        tags: ann?.tags ?? [],
        note: ann?.note ?? "",
      },
    });
  }

  private resolveOpenUri(session: SessionSummary, cleanQaOnly = false): vscode.Uri {
    const sessionKey = normalizeCacheKey(session.fsPath);
    const existingDocument = vscode.workspace.textDocuments.find((document) => {
      if (!isTranscriptDocumentUri(document.uri, this.scheme)) return false;
      const fsPath = getSessionFsPathFromUri(document.uri);
      const isDocClean = new URLSearchParams(document.uri.query).get("clean") === "1";
      if (isDocClean !== cleanQaOnly) return false;
      return fsPath ? normalizeCacheKey(fsPath) === sessionKey : false;
    });
    if (existingDocument) return existingDocument.uri;

    const params: Record<string, string> = { fsPath: session.fsPath };
    if (cleanQaOnly) params.clean = "1";
    const query = new URLSearchParams(params).toString();
    const baseFileName = buildTranscriptDocumentFileName(session.displayTitle);
    const fileName = cleanQaOnly
      ? `${baseFileName.replace(/\.md$/, "")} (Clean QA).md`
      : baseFileName;
    return vscode.Uri.from({ scheme: this.scheme, path: `/${fileName}`, query });
  }

  private resolveSessionFromUri(uri: vscode.Uri): SessionSummary | undefined {
    if (!isTranscriptDocumentUri(uri, this.scheme)) return undefined;
    const fsPath = getSessionFsPathFromUri(uri);
    return fsPath ? this.historyService.findByFsPath(fsPath) : undefined;
  }
}

function isTranscriptDocumentUri(uri: vscode.Uri, scheme: string): boolean {
  if (uri.scheme !== scheme || !uri.path.startsWith("/") || !uri.path.toLowerCase().endsWith(".md")) return false;
  return !uri.path.slice(1).includes("/");
}

function getSessionFsPathFromUri(uri: vscode.Uri): string | null {
  const fsPath = new URLSearchParams(uri.query).get("fsPath");
  if (
    !fsPath ||
    fsPath.length > 4_096 ||
    !path.isAbsolute(fsPath) ||
    /[\u0000-\u001f\u007f]/u.test(fsPath)
  ) {
    return null;
  }
  return fsPath;
}
