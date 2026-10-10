export type RosterRow = {
  email: string;
  display_name: string;
  team_name: string;
};
export function validateRoster(rows: Record<string, unknown>[]) {
  const errors: string[] = [],
    normalized: RosterRow[] = [],
    seen = new Set<string>();
  if (!rows.length || rows.length > 1000)
    errors.push("Select a roster containing 1–1000 data rows.");
  rows.forEach((row, i) => {
    const unknown = Object.keys(row).filter(
      (k) => !["email", "display_name", "team_name"].includes(k),
    );
    if (unknown.length)
      errors.push(`Row ${i + 2}: unknown columns: ${unknown.join(", ")}`);
    const email = String(row.email ?? "")
        .trim()
        .toLowerCase(),
      display_name = String(row.display_name ?? "").trim(),
      team_name = String(row.team_name ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
      errors.push(`Row ${i + 2}: invalid email`);
    if (!display_name || display_name.length > 80)
      errors.push(`Row ${i + 2}: display_name must be 1–80 characters`);
    if (team_name.length > 100)
      errors.push(`Row ${i + 2}: team_name exceeds 100 characters`);
    if (seen.has(email))
      errors.push(
        `Row ${i + 2}: duplicate email or conflicting team assignment`,
      );
    seen.add(email);
    normalized.push({ email, display_name, team_name });
  });
  return { rows: normalized, errors };
}
export async function parseRoster(file: File) {
  if (!/\.(csv|xlsx)$/i.test(file.name) || file.size > 2097152 || !file.size)
    throw new Error("Choose a CSV or XLSX file no larger than 2 MB.");
  const XLSX = await import("@e965/xlsx");
  const book = XLSX.read(await file.arrayBuffer(), {
    type: "array",
    sheetRows: 1002,
    cellFormula: true,
  });
  if (book.SheetNames.length !== 1)
    throw new Error("Use exactly one worksheet.");
  const sheet = book.Sheets[book.SheetNames[0]];
  if (Object.values(sheet).some((v) => v && typeof v === "object" && "f" in v))
    throw new Error(
      "Formulas are not accepted in roster files. Use literal values.",
    );
  const headers =
    XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 })[0] ?? [];
  if (new Set(headers).size !== headers.length)
    throw new Error("Duplicate column headers are not allowed.");
  return validateRoster(
    XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: "",
      raw: false,
    }),
  );
}
export function safeCsvCell(value: string) {
  return (
    '"' +
    (/^[\s]*[=+\-@\t\r]/.test(value) ? "'" + value : value).replaceAll(
      '"',
      '""',
    ) +
    '"'
  );
}
