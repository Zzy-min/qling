import { getLocalizedText } from "../i18n/index.js";

export interface LocalGuidancePanelInput {
  title: string;
  reason: string;
  next: string;
  example: string;
  boundary?: string;
  localExecution?: boolean;
  modelCall?: boolean;
}

export function formatLocalGuidancePanel(input: LocalGuidancePanelInput): string {
  const t = getLocalizedText();
  const localExecution = input.localExecution ?? true;
  const modelCall = input.modelCall ?? false;
  const boundary = input.boundary ?? t.boundaries.localNoModel;

  return [
    input.title,
    `${t.labels.reason}: ${input.reason}`,
    `${t.labels.next}: ${input.next}`,
    `${t.labels.example}: ${input.example}`,
    `${t.labels.localExecution}: ${localExecution ? t.labels.yes : t.labels.no}`,
    `${t.labels.modelCall}: ${modelCall ? t.labels.yes : t.labels.no}`,
    `${t.labels.boundary}: ${boundary}`,
  ].join("\n");
}
