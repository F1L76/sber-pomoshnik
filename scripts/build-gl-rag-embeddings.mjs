/**
 * Сборка нейро-эмбеддингов GigaChat для RAG (опционально, фаза 2+).
 * Сейчас поиск использует локальный hybrid (слова + char n-gram + intent).
 * Этот скрипт — заготовка: когда OAuth до Сбера доступен, можно дописать запись
 * data/gl_rag/embeddings.f32 и подключить в retrieve.
 *
 * Usage: node scripts/build-gl-rag-embeddings.mjs
 */
console.log(
    "Эмбеддинги GigaChat пока не собраны: с этой среды OAuth к ngw.devices.sberbank.ru недоступен.\n"
    + "Рабочий hybrid уже в lib/conclusion-qa.mjs (TF-IDF + char 3-gram + intent).\n"
    + "Когда API доступен — допишем батчевую запись embeddings рядом с chunks.jsonl."
);
process.exit(0);
