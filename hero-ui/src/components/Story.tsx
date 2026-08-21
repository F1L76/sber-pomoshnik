const STEPS = [
  { n: "01", title: "Актив", body: "Материальный объект: здание, земля, оборудование, транспорт." },
  { n: "02", title: "Переводим в ЦФА", body: "Цифровой финансовый актив — токен права на объект." },
  { n: "03", title: "AI-профиль", body: "Цифровой двойник. Сам сравнивает, оценивает, следит и действует." },
  { n: "04", title: "Четыре службы", body: "Залог, мониторинг залога, кредитный мониторинг, проблемные активы." },
] as const;

const CAPABILITIES = [
  { title: "Анализ рынка", body: "Сверяет актив с рыночными аналогами." },
  { title: "Оценка в реальном времени", body: "Непрерывно пересчитывает стоимость." },
  { title: "Контроль залога", body: "Следит, хватает ли покрытия." },
  { title: "Выявление рисков", body: "Ловит отклонения и ранние сигналы." },
  { title: "Рекомендации к действию", body: "Сам запускает нужный процесс." },
  { title: "Прогнозирование", body: "Цена, ликвидность, риск вперёд." },
  { title: "Мониторинг 24/7", body: "Данные, статус, документы — без паузы." },
] as const;

const SERVICES = [
  { title: "Залоговая служба", body: "Проверка, оценка, решение." },
  { title: "Мониторинг залогов", body: "Статус объекта и рыночная стоимость." },
  { title: "Кредитный мониторинг", body: "Риски и финансовое состояние заёмщика." },
  { title: "Проблемные активы", body: "Стратегия реализации и ликвидность." },
] as const;

const VALUES = [
  { title: "Автономность", body: "AI ведёт актив без участия человека на стандарте." },
  { title: "Риски", body: "Меньше потерь за счёт раннего сигнала." },
  { title: "Доходность", body: "Рост ликвидности и возврата." },
  { title: "Скорость", body: "Решение в темпе рынка, не в темпе очереди." },
  { title: "Доверие", body: "Прозрачность, контроль, воспроизводимость." },
  { title: "Масштаб", body: "Больше портфель — не больше штата." },
] as const;

export function Story() {
  return (
    <div className="relative z-[1] bg-white text-black">
      <section id="flow" className="px-5 py-24 sm:px-8 md:px-10">
        <p className="mb-4 text-[13px] sm:text-[15px]">Контур</p>
        <h2
          className="mb-10 max-w-2xl font-normal"
          style={{ fontSize: "clamp(22px, 4vw, 36px)", lineHeight: 1.2 }}
        >
          Актив → ЦФА → AI-профиль → службы Сбера больше не держат объект руками
        </h2>
        <div className="grid gap-8 md:grid-cols-4">
          {STEPS.map((step) => (
            <div key={step.n}>
              <p className="mb-2 text-[13px] text-black/50">{step.n}</p>
              <p className="mb-2 text-[18px] sm:text-[20px]">{step.title}</p>
              <p className="text-[15px] leading-snug text-black/70">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="profile" className="px-5 py-24 sm:px-8 md:px-10">
        <p className="mb-4 text-[13px] sm:text-[15px]">Профиль</p>
        <h2
          className="mb-4 max-w-2xl font-normal"
          style={{ fontSize: "clamp(22px, 4vw, 36px)", lineHeight: 1.2 }}
        >
          Цифровой двойник актива, который работает 24/7
        </h2>
        <p className="mb-12 max-w-xl text-[16px] leading-snug text-black/70 sm:text-[18px]">
          Семь контуров вокруг одного паспорта. Человек входит только в исключении.
        </p>
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((item) => (
            <div key={item.title}>
              <p className="mb-2 text-[18px] sm:text-[20px]">{item.title}</p>
              <p className="text-[15px] leading-snug text-black/70">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="services" className="px-5 py-24 sm:px-8 md:px-10">
        <p className="mb-4 text-[13px] sm:text-[15px]">Службы</p>
        <h2
          className="mb-12 max-w-2xl font-normal"
          style={{ fontSize: "clamp(22px, 4vw, 36px)", lineHeight: 1.2 }}
        >
          Заменяет четыре службы Сбера
        </h2>
        <div className="grid gap-8 md:grid-cols-2">
          {SERVICES.map((item) => (
            <div key={item.title} className="border-t border-black/10 pt-6">
              <p className="mb-2 text-[18px] sm:text-[20px]">{item.title}</p>
              <p className="text-[15px] leading-snug text-black/70">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="value" className="bg-black px-5 py-16 text-white sm:px-8 md:px-10">
        <p
          className="max-w-3xl font-normal"
          style={{ fontSize: "clamp(20px, 3.4vw, 28px)", lineHeight: 1.3 }}
        >
          AI сам понимает, анализирует, прогнозирует и действует. Человек
          подключается только в исключительных случаях.
        </p>
      </section>

      <section className="px-5 py-24 sm:px-8 md:px-10">
        <p className="mb-4 text-[13px] sm:text-[15px]">Ценность для Сбера</p>
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {VALUES.map((item) => (
            <div key={item.title}>
              <p className="mb-2 text-[18px] sm:text-[20px]">{item.title}</p>
              <p className="text-[15px] leading-snug text-black/70">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="contact" className="px-5 pb-24 sm:px-8 md:px-10">
        <p className="text-[15px] text-black/60">
          Концепт 2030. Не промышленный продукт. Обсуждение — внутри залоговой службы.
        </p>
      </section>
    </div>
  );
}
