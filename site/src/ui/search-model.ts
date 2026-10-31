import type { Crop, CropGroup, CropsFile } from "../data/crops";

export const RESULT_LIMIT = 7;
export const POPULAR_LIMIT = 5;

export interface CropSelection {
  kind: "crops";
  label: string;
  cropIds: number[];
}

export interface GroupSelection {
  kind: "groups";
  label: string;
  groupIds: string[];
}

export type SearchSelection = CropSelection | GroupSelection;

export type SearchOptionKind = "crop" | "group" | "ambiguous" | "action";

export interface SearchOption {
  id: string;
  label: string;
  meta?: string;
  kind: SearchOptionKind;
  selection?: SearchSelection;
  action?: "clear";
}

export interface SearchView {
  options: SearchOption[];
  message?: string;
  popular?: boolean;
}

interface CropRecord {
  crop: Crop;
  groupLabel: string;
  terms: string[];
  aliasTerms: string[];
}

interface GroupRecord {
  group: CropGroup;
  name: string;
}

export interface CropSearchIndex {
  crops: CropRecord[];
  groups: GroupRecord[];
  groupLabels: Record<string, string>;
}

const POPULAR_CROPS = [
  { label: "Barley", term: "barley" },
  { label: "Wheat", term: "wheat" },
  { label: "Maize", term: "maize" },
  { label: "Potatoes", term: "potato" },
  { label: "Oilseed rape", term: "oilseed rape" },
] as const;

const GROUP_CHIPS = [
  { label: "Grass", groupIds: ["grassland"] },
  { label: "Cereals", groupIds: ["cereals"] },
  { label: "Break/root", groupIds: ["oilseeds_break", "roots"] },
  { label: "Horticulture", groupIds: ["horticulture"] },
  { label: "Fallow", groupIds: ["fallow"] },
] as const;

const QUERY_ALIASES: Record<string, string[]> = {
  spud: ["potato"],
  potato: ["potato"],
  corn: ["maize"],
  rape: ["oilseed rape"],
  osr: ["oilseed rape"],
  canola: ["oilseed rape"],
  beet: ["beet"],
  barley: ["barley"],
  wheat: ["wheat"],
  oat: ["oat"],
  grass: ["grass"],
  pasture: ["pasture"],
  hay: ["hay"],
  bean: ["bean"],
  pea: ["pea"],
  tillage: ["cereal", "oilseed", "root"],
};

const QUERY_GROUPS: Record<string, string[]> = {
  grass: ["grassland"],
  pasture: ["grassland"],
  tillage: ["cereals", "oilseeds_break", "roots"],
  break: ["oilseeds_break", "roots"],
};

const EXACT_SCORE = 100;
const PREFIX_SCORE = 80;
const TOKEN_PREFIX_SCORE = 60;
const SUBSTRING_SCORE = 40;
const SUBSEQUENCE_SCORE = 20;

function singularizeToken(token: string): string {
  if (token.length < 3) return token;
  if (/(us|ss|is)$/.test(token)) return token;
  if (token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.endsWith("oes")) return token.slice(0, -2);
  if (/(ses|xes|zes|ches|shes)$/.test(token)) return token.slice(0, -2);
  if (token.endsWith("s")) return token.slice(0, -1);
  return token;
}

export function normalize(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map(singularizeToken)
    .join(" ");
}

export function scoreTerm(query: string, candidate: string): number {
  if (!query || !candidate) return 0;
  if (candidate === query) return EXACT_SCORE;
  if (candidate.startsWith(query)) return PREFIX_SCORE;
  if (candidate.split(" ").some((token) => token.startsWith(query))) {
    return TOKEN_PREFIX_SCORE;
  }
  if (candidate.includes(query)) return SUBSTRING_SCORE;
  return isSubsequence(query, candidate) ? SUBSEQUENCE_SCORE : 0;
}

function isSubsequence(needle: string, haystack: string): boolean {
  let index = 0;
  for (const character of haystack) {
    if (character === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return needle.length === 0;
}

function splitAliases(value: string | undefined): string[] {
  return (value ?? "")
    .split(";")
    .map((alias) => normalize(alias))
    .filter(Boolean);
}

export function buildCropSearchIndex(file: CropsFile): CropSearchIndex {
  const groupLabels: Record<string, string> = {};
  for (const group of file.groups) groupLabels[group.group_id] = group.name;

  const crops = file.crops
    .filter((crop) => crop.include !== false)
    .map((crop): CropRecord => {
      const aliasTerms = splitAliases(crop.aliases);
      const terms = Array.from(
        new Set(
          [normalize(crop.name), normalize(crop.display_name), ...aliasTerms].filter(
            Boolean,
          ),
        ),
      );
      return {
        crop,
        groupLabel: groupLabels[crop.group] ?? crop.group,
        terms,
        aliasTerms,
      };
    });

  const groups = file.groups
    .filter((group) => group.include !== false)
    .map((group): GroupRecord => ({ group, name: normalize(group.name) }));

  return { crops, groups, groupLabels };
}

function cropSelection(records: readonly CropRecord[], label: string): CropSelection {
  return {
    kind: "crops",
    label,
    cropIds: Array.from(new Set(records.map((record) => record.crop.crop_id))),
  };
}

function exactAliasMatches(
  index: CropSearchIndex,
  term: string,
): CropRecord[] {
  return index.crops.filter((record) => record.aliasTerms.includes(term));
}

function cropOption(record: CropRecord, idPrefix: string): SearchOption {
  return {
    id: `${idPrefix}:${record.crop.crop_id}`,
    label: record.crop.display_name,
    meta: record.groupLabel,
    kind: "crop",
    selection: cropSelection([record], record.crop.display_name),
  };
}

function groupOption(record: GroupRecord, label = `${record.group.name} group`): SearchOption {
  return {
    id: `group:${record.group.group_id}`,
    label,
    meta: "Group",
    kind: "group",
    selection: {
      kind: "groups",
      label,
      groupIds: [record.group.group_id],
    },
  };
}

export function popularView(index: CropSearchIndex): SearchView {
  const options: SearchOption[] = [];

  for (const popular of POPULAR_CROPS.slice(0, POPULAR_LIMIT)) {
    const records = exactAliasMatches(index, popular.term);
    if (records.length === 0) continue;
    options.push({
      id: `popular:${popular.term}`,
      label: popular.label,
      meta: records.length > 1 ? `${records.length} crops` : records[0].groupLabel,
      kind: records.length > 1 ? "ambiguous" : "crop",
      selection: cropSelection(records, popular.label),
    });
  }

  for (const chip of GROUP_CHIPS) {
    const records = chip.groupIds.flatMap((group_id) =>
      index.groups.filter((record) => record.group.group_id === group_id),
    );
    if (records.length === 0) continue;
    const label = chip.label;
    options.push({
      id: `chip:${chip.groupIds.join("+")}`,
      label,
      meta: "Group",
      kind: "group",
      selection: {
        kind: "groups",
        label,
        groupIds: records.map((record) => record.group.group_id),
      },
    });
  }

  return { options, popular: true };
}

function queryTerms(query: string): string[] {
  const aliases = QUERY_ALIASES[query] ?? [];
  return Array.from(new Set([query, ...aliases.map((alias) => normalize(alias))]));
}

function scoreRecord(record: CropRecord, terms: readonly string[]): number {
  let best = 0;
  for (const term of terms) {
    for (const candidate of record.terms) {
      best = Math.max(best, scoreTerm(term, candidate));
    }
  }
  return best;
}

function scoredGroups(
  index: CropSearchIndex,
  query: string,
  terms: readonly string[],
): Array<{ record: GroupRecord; score: number }> {
  const aliases = QUERY_GROUPS[query] ?? [];
  const scored: Array<{ record: GroupRecord; score: number }> = [];
  for (const record of index.groups) {
    let score = 0;
    for (const term of terms) {
      score = Math.max(score, scoreTerm(term, record.name));
    }
    const expanded = aliases.includes(record.group.group_id);
    if (expanded) {
      score = Math.max(score, PREFIX_SCORE + 10);
    }
    const singleCropGroup = record.group.crop_ids.length < 2;
    if (score > 0 && (expanded || !singleCropGroup)) {
      scored.push({ record, score });
    }
  }
  return scored.sort(
    (a, b) => b.score - a.score || a.record.group.name.localeCompare(b.record.group.name),
  );
}

function commonPrefixLength(a: string, b: string): number {
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index]) {
    index += 1;
  }
  return index;
}

function suggestions(index: CropSearchIndex, query: string): CropRecord[] {
  return index.crops
    .map((record) => ({
      record,
      prefix: Math.max(
        ...record.terms.map((term) => commonPrefixLength(query, term)),
      ),
    }))
    .filter((entry) => entry.prefix > 0)
    .sort(
      (a, b) =>
        b.prefix - a.prefix ||
        a.record.crop.display_name.localeCompare(b.record.crop.display_name),
    )
    .slice(0, 3)
    .map((entry) => entry.record);
}

function noMatchView(
  index: CropSearchIndex,
  rawQuery: string,
  query: string,
): SearchView {
  const near = suggestions(index, query);
  const options: SearchOption[] = near.map((record) =>
    cropOption(record, "suggest"),
  );
  options.push({
    id: "action:clear",
    label: "Clear search",
    meta: "Action",
    kind: "action",
    action: "clear",
  });

  const shown = rawQuery.trim().replace(/\s+/g, " ");
  const suggestionText =
    near.length > 0
      ? ` Try ${near.map((record) => record.crop.display_name).join(", ")}.`
      : "";
  return {
    options,
    message: `No crops match “${shown}”.${suggestionText} Clear the search to browse popular crops.`,
  };
}

export function searchCrops(
  index: CropSearchIndex,
  rawQuery: string,
  limit = RESULT_LIMIT,
): SearchView {
  const query = normalize(rawQuery);
  if (!query) return popularView(index);

  const terms = queryTerms(query);
  const groups = scoredGroups(index, query, terms);
  const crops = index.crops
    .map((record) => ({ record, score: scoreRecord(record, terms) }))
    .filter((entry) => entry.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.record.crop.display_name.localeCompare(b.record.crop.display_name),
    );

  const options: SearchOption[] = [];
  const add = (option: SearchOption): void => {
    if (options.length < limit) options.push(option);
  };

  for (const entry of groups) add(groupOption(entry.record));
  for (const entry of crops) add(cropOption(entry.record, "crop"));

  const exact = exactAliasMatches(index, query);
  if (groups.length === 0 && exact.length > 1) {
    const shown = rawQuery.trim().replace(/\s+/g, " ");
    const label = `All ${shown} (${exact.length})`;
    add({
      id: `all:${query}`,
      label,
      meta: "Group",
      kind: "ambiguous",
      selection: cropSelection(exact, label),
    });
  }

  if (options.length === 0) return noMatchView(index, rawQuery, query);
  return { options };
}

export function describeView(view: SearchView, rawQuery: string): string {
  if (view.message) return view.message;
  if (view.popular || !rawQuery.trim()) {
    return "Popular crops and groups shown.";
  }
  const names = view.options
    .filter((option) => option.kind !== "action")
    .slice(0, 3)
    .map((option) => option.label);
  const count = view.options.filter((option) => option.kind !== "action").length;
  const noun = count === 1 ? "result" : "results";
  return names.length > 0
    ? `${count} ${noun} available: ${names.join(", ")}.`
    : `${count} ${noun} available.`;
}
