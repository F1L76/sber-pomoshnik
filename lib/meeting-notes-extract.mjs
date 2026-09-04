/**
 * Разбор текста заметок → договорённости + Markdown.
 * Без LLM. Правила: «Имя — задача», «отв. Имя: …», сроки, маркеры действий.
 *
 * node lib/meeting-notes-extract.mjs --self-check
 */

const ACTION_MARKERS = [
  "договорились",
  "договорённость",
  "договоренность",
  "ответственный",
  "отв.",
  "отв:",
  "сделать",
  "подготовить",
  "направить",
  "проверить",
  "согласовать",
  "отправить",
  "зафиксировать",
  "обеспечить",
  "завершить",
  "todo",
  "action",
  "задача",
];

const OWNER_RES = [
  // «Иван — сделать отчёт» / «Мария: согласовать»
  {
    re: /^([А-ЯЁA-Z][а-яёa-zA-Z\-]+(?:\s+[А-ЯЁA-Z][а-яёa-zA-Z\-]+)?)\s*[—\-–:]\s+(.+)$/u,
    ownerFirst: true,
  },
  // «сделать отчёт — Иван»
  {
    re: /^(.+?)\s*[—\-–]\s*([А-ЯЁA-Z][а-яёa-zA-Z\-]+)$/u,
    ownerFirst: false,
  },
  // «… (отв. Мария)» / «… (Мария)»
  {
    re: /^(.+?)\s*\(\s*(?:отв\.?|ответственный)?\s*([А-ЯЁA-Z][а-яёa-zA-Z\-]+)\s*\)$/iu,
    ownerFirst: false,
  },
  // «отв. Иван: …»
  {
    re: /^(?:отв\.?|ответственный)\s*[—\-–:]?\s*([А-ЯЁA-Z][а-яёa-zA-Z\-]+)\s*[—\-–:]?\s*(.+)$/iu,
    ownerFirst: true,
  },
];

const DUE_RE =
  /(?:до|срок|к)\s+((?:\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)|(?:понедельник|вторник|среда|четверг|пятниц\w*|суббот\w*|воскресень\w*|пн|вт|ср|чт|пт|сб|вс)|(?:завтра|послезавтра))/iu;

function stripBullet(line) {
  return line.replace(/^[\-\*\u2022\u25A1\u2610\s\[]+\]?\s*/u, "").trim();
}

function looksLikeAction(line) {
  const lower = line.toLowerCase();
  if (
    lower.startsWith("- [") ||
    lower.startsWith("☐") ||
    lower.startsWith("□") ||
    lower.startsWith("•")
  ) {
    return true;
  }
  return ACTION_MARKERS.some((m) => lower.includes(m));
}

function parseOwnerAndTask(line) {
  const trimmed = stripBullet(line);
  for (const { re, ownerFirst } of OWNER_RES) {
    const m = trimmed.match(re);
    if (!m) continue;
    const a = m[1].trim();
    const b = m[2].trim();
    return ownerFirst ? { owner: a, task: b } : { owner: b, task: a };
  }
  return { owner: null, task: trimmed };
}

function parseDue(text) {
  const m = text.match(DUE_RE);
  return m ? m[1] : null;
}

function hasOwnerPattern(line) {
  const t = stripBullet(line);
  return OWNER_RES.some(({ re }) => re.test(t));
}

/** @returns {{ actions: Array<{task:string, owner:string|null, due:string|null}>, rest: string[] }} */
export function extractActions(text) {
  const actions = [];
  const rest = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (looksLikeAction(line) || hasOwnerPattern(line)) {
      const { owner, task } = parseOwnerAndTask(line);
      actions.push({ task, owner, due: parseDue(line) });
    } else {
      rest.push(line);
    }
  }
  return { actions, rest };
}

export function renderMarkdown({ source, ocrText, actions, rest, createdAt = new Date() }) {
  const pad = (n) => String(n).padStart(2, "0");
  const d = createdAt;
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

  let md = `# Протокол договорённостей

- Источник: \`${source || "—"}\`
- Создано: ${stamp}
- Движок: OCR + правила (без LLM)

## Договорённости

`;

  if (!actions.length) {
    md += "_Не найдено по правилам — разметьте вручную._\n\n";
  } else {
    for (const a of actions) {
      const owner = a.owner ? ` — **${a.owner}**` : "";
      const due = a.due ? ` — до ${a.due}` : "";
      md += `- [ ] ${a.task}${owner}${due}\n`;
    }
    md += "\n";
  }

  const withOwner = new Map();
  for (const a of actions) {
    if (!a.owner) continue;
    if (!withOwner.has(a.owner)) withOwner.set(a.owner, []);
    withOwner.get(a.owner).push(a);
  }
  if (withOwner.size) {
    md += "## По ответственным\n\n";
    for (const name of [...withOwner.keys()].sort((a, b) => a.localeCompare(b, "ru"))) {
      md += `### ${name}\n`;
      for (const a of withOwner.get(name)) {
        const due = a.due ? ` — до ${a.due}` : "";
        md += `- [ ] ${a.task}${due}\n`;
      }
      md += "\n";
    }
  }

  if (rest.length) {
    md += "## Прочий текст\n\n";
    for (const line of rest) md += `- ${line}\n`;
    md += "\n";
  }

  md += `## Текст OCR

\`\`\`
${ocrText || ""}
\`\`\`
`;
  return md;
}

export function selfCheck() {
  const sample = `Встреча по залогу
Иван — подготовить отчёт до пятницы
отв. Мария: согласовать оценку к 12.09
Направить пакет в банк — Пётр
Обсудили риски по объекту
договорились проверить обременения
`;
  const { actions, rest } = extractActions(sample);
  if (actions.length < 4) throw new Error(`ожидали ≥4, получили ${actions.length}`);
  if (!actions.some((a) => a.owner === "Иван" && a.task.includes("отчёт"))) {
    throw new Error("нет Ивана/отчёта");
  }
  if (!actions.some((a) => a.owner === "Мария")) throw new Error("нет Марии");
  if (!actions.some((a) => a.owner === "Пётр")) throw new Error("нет Петра");
  if (!actions.some((a) => a.due === "пятницы" || a.due === "12.09")) {
    throw new Error("нет срока");
  }
  if (!rest.some((l) => l.includes("риски"))) throw new Error("прочий текст потерян");
  const md = renderMarkdown({ source: "self-check", ocrText: sample, actions, rest });
  if (!md.includes("## По ответственным")) throw new Error("нет секции по ответственным");
  if (!md.includes("- [ ]")) throw new Error("нет чеклиста");
  return actions.length;
}

const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  String(process.argv[1]).replace(/\\/g, "/").endsWith("meeting-notes-extract.mjs");

if (isMain && process.argv.includes("--self-check")) {
  const n = selfCheck();
  console.log(`OK: self-check passed (${n} actions)`);
}
