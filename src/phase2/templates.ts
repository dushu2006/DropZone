import type { Field } from "./forms";
const response: Field = {
  key: "response_preference",
  label: "Response preference (no private contact details)",
  type: "select",
  options: ["thread_reply", "organizer_contact"],
};
export const templates: {
  code: string;
  name: string;
  description: string;
  fields: Field[];
}[] = [
  {
    code: "lost_found",
    name: "Lost & found",
    description: "Help an item find its owner.",
    fields: [
      {
        key: "kind",
        label: "Lost or found",
        type: "select",
        options: ["lost", "found"],
        required: true,
      },
      { key: "item", label: "Item name", required: true },
      { key: "place", label: "Approximate place" },
      {
        key: "approximate_time",
        label: "Approximate time",
        type: "datetime-local",
      },
      response,
    ],
  },
  {
    code: "find_teammate",
    name: "Find a teammate",
    description: "Find the skills your team needs.",
    fields: [
      { key: "activity", label: "Event or activity", required: true },
      { key: "skills", label: "Skills or interests sought", required: true },
      {
        key: "openings",
        label: "Remaining openings",
        type: "number",
        min: 1,
        max: 50,
        required: true,
      },
      response,
    ],
  },
  {
    code: "need_resource",
    name: "Need an item or resource",
    description: "Ask for something useful nearby.",
    fields: [
      { key: "item", label: "Item or resource needed", required: true },
      {
        key: "quantity",
        label: "Quantity",
        type: "number",
        min: 1,
        max: 1000,
        required: true,
      },
      { key: "pickup", label: "Pickup preference" },
      response,
    ],
  },
  {
    code: "ask_help",
    name: "Ask for help",
    description: "Get help with a task or question.",
    fields: [
      { key: "help_category", label: "Help category", required: true },
      { key: "context", label: "Relevant context" },
      response,
    ],
  },
  {
    code: "offer_resource",
    name: "Offer help or resources",
    description: "Share what you can offer.",
    fields: [
      { key: "offering", label: "Help or resource offered", required: true },
      { key: "availability", label: "Availability", required: true },
      {
        key: "quantity",
        label: "Quantity (optional)",
        type: "number",
        min: 1,
        max: 1000,
      },
      response,
    ],
  },
  {
    code: "promotion",
    name: "Promotions & offers",
    description: "Requires staff approval; limited to two submissions per day.",
    fields: [
      { key: "offer", label: "Offer details", required: true },
      {
        key: "valid_until",
        label: "Valid until",
        type: "datetime-local",
        required: true,
      },
    ],
  },
  {
    code: "community_question",
    name: "Community question",
    description: "Start a thoughtful discussion.",
    fields: [{ key: "topic", label: "Discussion category", required: true }],
  },
  {
    code: "custom",
    name: "Custom post",
    description: "Submit for moderator review before publication.",
    fields: [
      { key: "reason", label: "Why a custom post?", required: true },
      { key: "audience", label: "Intended audience" },
    ],
  },
];
export function validateTemplate(code: string, values: Record<string, string>) {
  const template = templates.find((t) => t.code === code);
  if (!template) throw new Error("Unknown template.");
  for (const field of template.fields) {
    const value = values[field.key]?.trim() ?? "";
    if (field.required && !value)
      throw new Error(`${field.label} is required.`);
    if (value.length > 1000) throw new Error(`${field.label} is too long.`);
    if (
      value &&
      field.type === "number" &&
      (!Number.isInteger(Number(value)) ||
        Number(value) < (field.min ?? 1) ||
        Number(value) > (field.max ?? 1000))
    )
      throw new Error(`${field.label} is outside the allowed range.`);
    if (value && field.options && !field.options.includes(value))
      throw new Error(`Invalid ${field.label}.`);
  }
  return Object.fromEntries(
    template.fields
      .filter((f) => values[f.key]?.trim())
      .map((f) => [
        f.key,
        f.type === "datetime-local"
          ? new Date(values[f.key]).toISOString()
          : values[f.key].trim(),
      ]),
  );
}
