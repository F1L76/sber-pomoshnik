#!/usr/bin/env swift
// MVP: рукописные заметки → OCR (macOS Vision) → договорённости → Markdown.
// Без LLM. Правило-эвристика: строки с маркерами действий / «кто — что».
//
// Usage:
//   swift scripts/meeting-notes-mvp.swift photo.jpg
//   swift scripts/meeting-notes-mvp.swift photo.jpg -o out.md
//   swift scripts/meeting-notes-mvp.swift --text $'Иван — отчёт до пятницы\n...'
//   swift scripts/meeting-notes-mvp.swift --self-check

import Foundation
import Vision
import AppKit

// MARK: - OCR

func ocrImage(at url: URL) throws -> String {
    guard let image = NSImage(contentsOf: url),
          let tiff = image.tiffRepresentation,
          let rep = NSBitmapImageRep(data: tiff),
          let cgImage = rep.cgImage
    else {
        throw NSError(
            domain: "meeting-notes",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "не удалось открыть изображение: \(url.path)"]
        )
    }

    var out = ""
    var err: Error?
    let req = VNRecognizeTextRequest { request, error in
        if let error { err = error; return }
        let observations = (request.results as? [VNRecognizedTextObservation]) ?? []
        // ponytail: topCandidates(1) — достаточно для MVP; при шуме рукописи поднять до 3 и голосовать
        out = observations.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
    }
    req.recognitionLevel = .accurate
    req.usesLanguageCorrection = true
    if #available(macOS 13.0, *) {
        req.recognitionLanguages = ["ru-RU", "en-US"]
    }

    try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([req])
    if let err { throw err }
    return out.trimmingCharacters(in: .whitespacesAndNewlines)
}

// MARK: - Extract

struct ActionItem: Equatable {
    var task: String
    var owner: String?
    var due: String?
}

private let actionMarkers: [String] = [
    "договорились", "договорённость", "договоренность",
    "ответственный", "отв.", "отв:",
    "сделать", "подготовить", "направить", "проверить", "согласовать",
    "отправить", "зафиксировать", "обеспечить", "завершить",
    "todo", "action", "задача",
]

private let ownerPatterns: [NSRegularExpression] = [
    // «Иван — сделать отчёт» / «Мария: согласовать»
    try! NSRegularExpression(pattern: #"^([А-ЯЁA-Z][а-яёa-zA-Z\-]+(?:\s+[А-ЯЁA-Z][а-яёa-zA-Z\-]+)?)\s*[—\-–:]\s+(.+)$"#),
    // «сделать отчёт — Иван» / «… (отв. Мария)»
    try! NSRegularExpression(pattern: #"^(.+?)\s*[—\-–]\s*([А-ЯЁA-Z][а-яёa-zA-Z\-]+)$"#),
    try! NSRegularExpression(pattern: #"^(.+?)\s*\(\s*(?:отв\.?|ответственный)?\s*([А-ЯЁA-Z][а-яёa-zA-Z\-]+)\s*\)$"#, options: .caseInsensitive),
    // «отв. Иван: …» / «ответственный — Пётр — …»
    try! NSRegularExpression(pattern: #"^(?:отв\.?|ответственный)\s*[—\-–:]?\s*([А-ЯЁA-Z][а-яёa-zA-Z\-]+)\s*[—\-–:]?\s*(.+)$"#, options: .caseInsensitive),
]

private let duePattern = try! NSRegularExpression(
    pattern: #"(?i)(?:до|срок|к)\s+((?:\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)|(?:понедельник|вторник|среда|четверг|пятниц\w*|суббот\w*|воскресень\w*|пн|вт|ср|чт|пт|сб|вс)|(?:завтра|послезавтра))"#,
    options: []
)

func looksLikeAction(_ line: String) -> Bool {
    let lower = line.lowercased()
    if lower.hasPrefix("- [") || lower.hasPrefix("☐") || lower.hasPrefix("□") || lower.hasPrefix("•") {
        return true
    }
    return actionMarkers.contains { lower.contains($0) }
}

func parseOwnerAndTask(_ line: String) -> (owner: String?, task: String) {
    let trimmed = line
        .replacingOccurrences(of: #"^[\-\*\u2022\u25A1\u2610\s\[]+\]?\s*"#, with: "", options: .regularExpression)
        .trimmingCharacters(in: .whitespaces)
    let range = NSRange(trimmed.startIndex..., in: trimmed)
    for re in ownerPatterns {
        if let m = re.firstMatch(in: trimmed, range: range), m.numberOfRanges >= 3,
           let r1 = Range(m.range(at: 1), in: trimmed),
           let r2 = Range(m.range(at: 2), in: trimmed) {
            let a = String(trimmed[r1]).trimmingCharacters(in: .whitespaces)
            let b = String(trimmed[r2]).trimmingCharacters(in: .whitespaces)
            // First group is owner if pattern starts with name / «отв.»
            let pat = re.pattern
            if pat.hasPrefix("^(?:отв") || pat.hasPrefix("^([А-ЯЁ") {
                return (a, b)
            }
            return (b, a)
        }
    }
    return (nil, trimmed)
}

func parseDue(_ text: String) -> String? {
    let range = NSRange(text.startIndex..., in: text)
    guard let m = duePattern.firstMatch(in: text, range: range),
          let r = Range(m.range(at: 1), in: text) else { return nil }
    return String(text[r])
}

func extractActions(from text: String) -> (actions: [ActionItem], rest: [String]) {
    var actions: [ActionItem] = []
    var rest: [String] = []
    for raw in text.components(separatedBy: .newlines) {
        let line = raw.trimmingCharacters(in: .whitespaces)
        if line.isEmpty { continue }
        if looksLikeAction(line) || ownerPatterns.contains(where: {
            $0.firstMatch(in: line, range: NSRange(line.startIndex..., in: line)) != nil
        }) {
            let (owner, task) = parseOwnerAndTask(line)
            actions.append(ActionItem(task: task, owner: owner, due: parseDue(line)))
        } else {
            rest.append(line)
        }
    }
    return (actions, rest)
}

// MARK: - Markdown

func renderMarkdown(source: String, ocrText: String, actions: [ActionItem], rest: [String]) -> String {
    let df = DateFormatter()
    df.locale = Locale(identifier: "ru_RU")
    df.dateFormat = "yyyy-MM-dd HH:mm"
    var md = """
    # Протокол договорённостей

    - Источник: `\(source)`
    - Создано: \(df.string(from: Date()))
    - Движок: macOS Vision OCR + правила (без LLM)

    ## Договорённости

    """
    if actions.isEmpty {
        md += "_Не найдено по правилам — разметьте вручную из блока «Текст OCR»._\n\n"
    } else {
        for a in actions {
            let owner = a.owner.map { " — **\($0)**" } ?? ""
            let due = a.due.map { " — до \($0)" } ?? ""
            md += "- [ ] \(a.task)\(owner)\(due)\n"
        }
        md += "\n"
    }

    // Группировка по ответственным
    let withOwner = Dictionary(grouping: actions.filter { $0.owner != nil }, by: { $0.owner! })
    if !withOwner.isEmpty {
        md += "## По ответственным\n\n"
        for name in withOwner.keys.sorted() {
            md += "### \(name)\n"
            for a in withOwner[name]! {
                let due = a.due.map { " — до \($0)" } ?? ""
                md += "- [ ] \(a.task)\(due)\n"
            }
            md += "\n"
        }
    }

    if !rest.isEmpty {
        md += "## Прочий текст\n\n"
        for line in rest {
            md += "- \(line)\n"
        }
        md += "\n"
    }

    md += """
    ## Текст OCR

    ```
    \(ocrText)
    ```
    """
    return md
}

// MARK: - CLI

func usage() -> Never {
    fputs(
        """
        Usage:
          swift scripts/meeting-notes-mvp.swift <image> [-o out.md]
          swift scripts/meeting-notes-mvp.swift --text "строки…" [-o out.md]
          swift scripts/meeting-notes-mvp.swift --self-check

        """,
        stderr
    )
    exit(2)
}

func selfCheck() {
    let sample = """
    Встреча по залогу
    Иван — подготовить отчёт до пятницы
    отв. Мария: согласовать оценку к 12.09
    Направить пакет в банк — Пётр
    Обсудили риски по объекту
    договорились проверить обременения
    """
    let (actions, rest) = extractActions(from: sample)
    assert(actions.count >= 4, "ожидали ≥4 договорённости, получили \(actions.count)")
    assert(actions.contains { $0.owner == "Иван" && $0.task.contains("отчёт") }, "нет Ивана/отчёта")
    assert(actions.contains { $0.owner == "Мария" }, "нет Марии")
    assert(actions.contains { $0.owner == "Пётр" }, "нет Петра")
    assert(actions.contains { $0.due == "пятницы" || $0.due == "12.09" }, "нет срока")
    assert(rest.contains { $0.contains("риски") }, "прочий текст потерян")
    let md = renderMarkdown(source: "self-check", ocrText: sample, actions: actions, rest: rest)
    assert(md.contains("## По ответственным"), "нет секции по ответственным")
    assert(md.contains("- [ ]"), "нет чеклиста")
    print("OK: self-check passed (\(actions.count) actions)")
}

func main() {
    let args = Array(CommandLine.arguments.dropFirst())
    if args.isEmpty { usage() }
    if args[0] == "--self-check" {
        selfCheck()
        return
    }

    var outPath: String?
    var textArg: String?
    var imagePath: String?
    var i = 0
    while i < args.count {
        let a = args[i]
        if a == "-o", i + 1 < args.count {
            outPath = args[i + 1]; i += 2; continue
        }
        if a == "--text", i + 1 < args.count {
            textArg = args[i + 1]; i += 2; continue
        }
        if a.hasPrefix("-") { usage() }
        imagePath = a; i += 1
    }

    let source: String
    let ocrText: String
    do {
        if let textArg {
            source = "stdin/--text"
            ocrText = textArg
        } else if let imagePath {
            let url = URL(fileURLWithPath: imagePath)
            source = url.lastPathComponent
            ocrText = try ocrImage(at: url)
        } else {
            usage()
        }
    } catch {
        fputs("OCR error: \(error.localizedDescription)\n", stderr)
        exit(1)
    }

    if ocrText.isEmpty {
        fputs("OCR вернул пустой текст — проверьте фото/качество рукописи.\n", stderr)
        exit(1)
    }

    let (actions, rest) = extractActions(from: ocrText)
    let md = renderMarkdown(source: source, ocrText: ocrText, actions: actions, rest: rest)

    if let outPath {
        do {
            try md.write(to: URL(fileURLWithPath: outPath), atomically: true, encoding: .utf8)
            print("Wrote \(outPath) (\(actions.count) actions)")
        } catch {
            fputs("Write error: \(error.localizedDescription)\n", stderr)
            exit(1)
        }
    } else {
        print(md)
    }
}

main()
