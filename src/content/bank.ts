import { unzipSync } from "fflate";
import { SESSION_BANK_KEY } from "../shared/defaults";
import { normalizeText, similarity, stableId } from "../shared/text";
import type { BankEntry, BankMatch, ExtractedQuestion } from "../shared/types";

const QUESTION_KEYS = ["question", "题目", "题干", "title", "stem", "内容"];
const ANSWER_KEYS = ["answer", "答案", "正确答案", "result"];
const EXPLANATION_KEYS = ["explanation", "解析", "答案解析", "analysis"];
const SOURCE_KEYS = ["source", "来源", "题库"];

function cell(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const found = Object.keys(row).find((candidate) => normalizeText(candidate) === normalizeText(key));
    if (found && row[found] != null) return String(row[found]).trim();
  }
  return "";
}

function optionsFromRow(row: Record<string, unknown>): string[] {
  const result: string[] = [];
  for (const key of ["A", "B", "C", "D", "E", "F", "G", "H"]) {
    const found = Object.keys(row).find((candidate) => candidate.trim().toUpperCase() === key || normalizeText(candidate) === normalizeText(`选项${key}`));
    if (found && row[found] != null && String(row[found]).trim()) result.push(String(row[found]).trim());
  }
  return result;
}

function rowsToEntries(rows: Array<Record<string, unknown>>, sourceName: string): BankEntry[] {
  return rows.flatMap((row, index) => {
    const question = cell(row, QUESTION_KEYS);
    const answer = cell(row, ANSWER_KEYS);
    if (!question || !answer) return [];
    return [{
      id: `${stableId(question)}-${index}`,
      question,
      answer,
      options: optionsFromRow(row),
      explanation: cell(row, EXPLANATION_KEYS),
      source: cell(row, SOURCE_KEYS) || sourceName,
    }];
  });
}

function parseDelimited(text: string, sourceName: string): BankEntry[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const headers = lines[0].split(delimiter).map((item) => item.trim());
  const rows = lines.slice(1).map((line) => {
    const values = line.split(delimiter);
    return Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ""]));
  });
  return rowsToEntries(rows, sourceName);
}

function parseXml(bytes: Uint8Array | undefined, filename: string): XMLDocument {
  if (!bytes) throw new Error(`Excel 文件缺少 ${filename}`);
  const document = new DOMParser().parseFromString(new TextDecoder().decode(bytes), "application/xml");
  if (document.querySelector("parsererror")) throw new Error(`无法解析 Excel 内部文件：${filename}`);
  return document;
}

function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? "A";
  let value = 0;
  for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64;
  return value - 1;
}

function xlsxRows(buffer: ArrayBuffer): Array<{ name: string; rows: Array<Record<string, unknown>> }> {
  const archive = unzipSync(new Uint8Array(buffer));
  const sharedDocument = archive["xl/sharedStrings.xml"] ? parseXml(archive["xl/sharedStrings.xml"], "sharedStrings.xml") : null;
  const sharedStrings = sharedDocument
    ? [...sharedDocument.getElementsByTagName("si")].map((item) => [...item.getElementsByTagName("t")].map((node) => node.textContent ?? "").join(""))
    : [];
  const workbook = parseXml(archive["xl/workbook.xml"], "workbook.xml");
  const relationships = parseXml(archive["xl/_rels/workbook.xml.rels"], "workbook.xml.rels");
  const targets = new Map([...relationships.getElementsByTagName("Relationship")].map((item) => [item.getAttribute("Id") ?? "", item.getAttribute("Target") ?? ""]));

  return [...workbook.getElementsByTagName("sheet")].map((sheet, sheetIndex) => {
    const relationshipId = sheet.getAttribute("r:id") || sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") || "";
    const target = targets.get(relationshipId) || `worksheets/sheet${sheetIndex + 1}.xml`;
    const normalizedTarget = target.replace(/^\//, "").replace(/^xl\//, "");
    const path = `xl/${normalizedTarget}`;
    const worksheet = parseXml(archive[path], path);
    const rawRows: string[][] = [...worksheet.getElementsByTagName("row")].map((row) => {
      const values: string[] = [];
      for (const cellNode of [...row.getElementsByTagName("c")]) {
        const index = columnIndex(cellNode.getAttribute("r") || "A1");
        const type = cellNode.getAttribute("t");
        const raw = cellNode.getElementsByTagName("v")[0]?.textContent ?? "";
        values[index] = type === "s"
          ? sharedStrings[Number(raw)] ?? ""
          : type === "inlineStr"
            ? [...cellNode.getElementsByTagName("t")].map((node) => node.textContent ?? "").join("")
            : raw;
      }
      return values;
    });
    const headers = rawRows[0] ?? [];
    const rows = rawRows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]))).filter((row) => Object.values(row).some(Boolean));
    return { name: sheet.getAttribute("name") || `Sheet ${sheetIndex + 1}`, rows };
  });
}

export async function parseBankFile(file: File): Promise<BankEntry[]> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "xlsx" || extension === "xls") {
    if (extension === "xls") throw new Error("为避免使用存在安全问题的旧格式解析器，请将 .xls 另存为 .xlsx 后导入。");
    return xlsxRows(await file.arrayBuffer()).flatMap((sheet) => rowsToEntries(sheet.rows, `${file.name} / ${sheet.name}`));
  }

  const text = await file.text();
  if (extension === "json") {
    const parsed = JSON.parse(text) as unknown;
    const rows = Array.isArray(parsed) ? parsed : typeof parsed === "object" && parsed && "questions" in parsed
      ? (parsed as { questions: unknown[] }).questions
      : [];
    return rowsToEntries(rows.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object"), file.name);
  }
  return parseDelimited(text, file.name);
}

export async function saveSessionBank(entries: BankEntry[]): Promise<void> {
  const serialized = JSON.stringify(entries);
  if (serialized.length > 7_500_000) throw new Error("题库过大，请控制在约 7 MB 以内，或拆分后导入。");
  await chrome.storage.session.set({ [SESSION_BANK_KEY]: entries });
}

export async function loadSessionBank(): Promise<BankEntry[]> {
  const stored = await chrome.storage.session.get(SESSION_BANK_KEY);
  return Array.isArray(stored[SESSION_BANK_KEY]) ? stored[SESSION_BANK_KEY] as BankEntry[] : [];
}

export async function clearSessionBank(): Promise<void> {
  await chrome.storage.session.remove(SESSION_BANK_KEY);
}

export function findBankMatch(question: ExtractedQuestion, entries: BankEntry[]): BankMatch | undefined {
  const normalized = normalizeText(question.stem);
  let best: BankMatch | undefined;
  for (const entry of entries) {
    const candidate = normalizeText(entry.question);
    if (candidate === normalized) return { entry, score: 1, exact: true };
    const score = similarity(normalized, candidate);
    if (!best || score > best.score) best = { entry, score, exact: false };
  }
  return best && best.score >= 0.56 ? best : undefined;
}
