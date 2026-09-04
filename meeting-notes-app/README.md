# Meeting Notes — заметки со встречи

Фото рукописи → OCR → договорённости в Markdown. **Без LLM.**

## Запуск (Mac)

```bash
npm start
```

Откройте http://127.0.0.1:8788/

Или двойной щелчок: `start.command`

## Зависимости

- Node.js 18+
- На Mac для лучшего OCR: Swift (встроен) — используется `scripts/meeting-notes-mvp.swift`
- Интернет для CDN (Bootstrap, Tesseract fallback)

Секреты и GigaChat **не нужны**.

## Windows / Linux

`npm start` работает. Серверный Vision OCR недоступен — в UI сработает Tesseract в браузере или вставьте текст вручную.

## Проверка

```bash
npm run check
```
