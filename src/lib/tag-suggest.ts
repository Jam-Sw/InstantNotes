export const TAG_SUGGEST_KEY = "suggest.tags";

export interface TagSuggestSetting {
  enabled: boolean;
  showAt: number;
}

export const TAG_SUGGEST_DEFAULT: TagSuggestSetting = { enabled: true, showAt: 0.5 };

export const SURENESS = [
  { value: 0.35, label: "Eager" },
  { value: 0.5, label: "Balanced" },
  { value: 0.7, label: "Careful" },
];

export function parseTagSuggest(value: unknown): TagSuggestSetting {
  const v = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const nearest = SURENESS.reduce((a, b) =>
    Math.abs(b.value - Number(v.showAt)) < Math.abs(a.value - Number(v.showAt)) ? b : a,
  );
  return {
    enabled: typeof v.enabled === "boolean" ? v.enabled : TAG_SUGGEST_DEFAULT.enabled,
    showAt: typeof v.showAt === "number" ? nearest.value : TAG_SUGGEST_DEFAULT.showAt,
  };
}
