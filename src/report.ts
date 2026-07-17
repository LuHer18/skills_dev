export interface ReportAction { readonly id: string; readonly status: "install" | "replace" | "skip" | "fail" }

export function renderReport(actions: readonly ReportAction[], warnings: readonly string[], outcome: "dry-run" | "planned" | "success" | "failure"): string {
  const lines = [`Outcome: ${outcome}`, "Skills:", ...[...actions].sort((left, right) => left.id.localeCompare(right.id)).map((action) => `- ${action.status} ${action.id}`)];
  if (warnings.length) lines.push("Warnings:", ...warnings.map((warning) => `- ${warning}`));
  return `${lines.join("\n")}\n`;
}
