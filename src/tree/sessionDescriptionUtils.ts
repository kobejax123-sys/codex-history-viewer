import type { SessionSummary } from "../sessions/sessionTypes";
import { t } from "../i18n";
import { safeDisplayPath } from "../utils/textUtils";
import type { CodexAgentPresentation } from "../agents/codexAgentRunsTypes";

export interface SessionRowLabelPresentation {
  label: string;
  tooltipLabel: string;
}

export interface SessionDescriptionOptions {
  showProject?: boolean;
}

export interface SessionDescriptionPresentation {
  rowDescription: string;
  tooltipDescription: string;
}

// 取路径尾部相对段（默认末 2 段），分隔符兼容 / 与 \；超出的部分以 …/ 前缀示意。
function formatProjectTailPath(projectCwd: string, maxSegments = 2): string {
  const trimmed = String(projectCwd ?? "").trim();
  if (!trimmed) return "";
  const segments = trimmed.split(/[\\/]+/).filter((segment) => segment.length > 0);
  if (segments.length === 0) return trimmed;
  if (segments.length <= maxSegments) return segments.join("/");
  return `…/${segments.slice(-maxSegments).join("/")}`;
}

export function buildSessionRowLabelPresentation(
  timestamp: string,
  title: string,
  showTimestamp: boolean,
): SessionRowLabelPresentation {
  const normalizedTimestamp = String(timestamp ?? "").trim();
  const normalizedTitle = String(title ?? "").trim();
  const tooltipLabel = [normalizedTimestamp, normalizedTitle].filter((part) => part.length > 0).join(" ");
  return {
    label: showTimestamp ? tooltipLabel : normalizedTitle,
    tooltipLabel,
  };
}

export function buildSessionDescription(
  session: SessionSummary,
  tags: readonly string[],
  projectAlias?: string,
  projectDisplayCwd?: string | null,
  agentPresentation?: CodexAgentPresentation,
  hidden = false,
  options: SessionDescriptionOptions = {},
): string {
  const presentation = buildSessionDescriptionPresentation(
    session,
    tags,
    projectAlias,
    projectDisplayCwd,
    agentPresentation,
    hidden,
    options.showProject !== false,
  );
  return options.showProject === false
    ? presentation.rowDescription
    : presentation.tooltipDescription;
}

export function buildSessionDescriptionPresentation(
  session: SessionSummary,
  tags: readonly string[],
  projectAlias?: string,
  projectDisplayCwd?: string | null,
  agentPresentation?: CodexAgentPresentation,
  hidden = false,
  showProject = true,
): SessionDescriptionPresentation {
  const leadingParts: string[] = [];
  if (agentPresentation?.relation === "child" || agentPresentation?.relation === "both") {
    leadingParts.push(`${t("codexAgentRuns.subagent")} · ${agentPresentation.taskLabel}`);
  }
  if (
    (agentPresentation?.relation === "parent" || agentPresentation?.relation === "both") &&
    agentPresentation.directChildCount > 0
  ) {
    leadingParts.push(t("codexAgentRuns.directChildrenDescription", agentPresentation.directChildCount));
  }
  if (session.storage.archiveState === "archived") leadingParts.push(t("tree.description.archived"));
  if (hidden) leadingParts.push(t("tree.description.hidden"));

  const alias = String(projectAlias ?? "").trim();
  const projectPart = alias
    ? alias
    : projectDisplayCwd
      ? safeDisplayPath(projectDisplayCwd, 80)
      : session.cwdShort || "";
  // 行内只显示尾部相对段，避免重复前缀挤占标题；tooltip 保留较完整路径。
  const rowProjectPart = alias
    ? alias
    : projectDisplayCwd
      ? formatProjectTailPath(projectDisplayCwd)
      : session.cwdShort || "";
  const tagPart = tags.length > 0 ? `#${tags.join(" #")}` : "";
  const tooltipParts = [...leadingParts];
  if (projectPart) tooltipParts.push(projectPart);
  if (tagPart) tooltipParts.push(tagPart);

  const rowParts = showProject
    ? [...leadingParts, ...(rowProjectPart ? [rowProjectPart] : []), ...(tagPart ? [tagPart] : [])]
    : [...leadingParts, ...(tagPart ? [tagPart] : [])];
  return {
    rowDescription: rowParts.join("  "),
    tooltipDescription: tooltipParts.join("  "),
  };
}
