import { motion } from "motion/react";

function MaterialIcon({
  d,
  className,
}: {
  d: string;
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path fill="currentColor" d={d} />
    </svg>
  );
}

export function CapabilitiesContent() {
  return (
    <div className="px-8 md:px-16 lg:px-20 pt-24 pb-10 flex flex-col min-h-screen">
      <motion.header
        className="mb-auto"
        initial={{ filter: "blur(10px)", opacity: 0, y: 20 }}
        animate={{ filter: "blur(0px)", opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.2 }}
      >
        <div className="text-sm font-body text-white/80 mb-6">
          Capabilities
        </div>
        <h2 className="font-heading italic text-white text-6xl md:text-7xl lg:text-[6rem] leading-[0.9] tracking-[-3px]">
          Контуры
          <br />
          взаимодействия
        </h2>
      </motion.header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-16 flex-1">
        <motion.article
          className="liquid-glass rounded-[1.25rem] p-6 min-h-[360px] flex flex-col"
          initial={{ filter: "blur(10px)", opacity: 0, y: 20 }}
          whileInView={{ filter: "blur(0px)", opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.6 }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="liquid-glass rounded-[0.75rem] w-11 h-11 flex items-center justify-center">
              <MaterialIcon
                className="w-6 h-6 text-white"
                d="M5 21q-.825 0-1.412-.587T3 19V5q0-.825.588-1.412T5 3h14q.825 0 1.413.588T21 5v14q0 .825-.587 1.413T19 21H5Zm1-4h12l-3.75-5-3 4L9 13l-3 4L6 17Z"
              />
            </div>

            <div className="flex flex-wrap justify-end gap-1.5 max-w-[70%]">
              <span className="liquid-glass rounded-full px-3 py-1 text-[11px] text-white/90 font-body whitespace-nowrap">
                Интеграционные дефекты
              </span>
              <span className="liquid-glass rounded-full px-3 py-1 text-[11px] text-white/90 font-body whitespace-nowrap">
                Обратная связь КП
              </span>
              <span className="liquid-glass rounded-full px-3 py-1 text-[11px] text-white/90 font-body whitespace-nowrap">
                Валидация исправлений
              </span>
              <span className="liquid-glass rounded-full px-3 py-1 text-[11px] text-white/90 font-body whitespace-nowrap">
                Управление качеством
              </span>
            </div>
          </div>

          <div className="flex-1" />

          <h3 className="font-heading italic text-white text-3xl md:text-4xl tracking-[-1px] leading-none">
            Ошибки и исправления
          </h3>
          <p className="mt-3 text-sm text-white/90 font-body font-light leading-snug max-w-[32ch]">
            ТМ получает от КП информацию об ошибках в интеграции АС СБОФ и
            АС Залоги, направляет разработчикам АС и возвращает КП ответ после
            устранения дефектов.
          </p>
        </motion.article>

        <motion.article
          className="liquid-glass rounded-[1.25rem] p-6 min-h-[360px] flex flex-col"
          initial={{ filter: "blur(10px)", opacity: 0, y: 20 }}
          whileInView={{ filter: "blur(0px)", opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.6, delay: 0.05 }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="liquid-glass rounded-[0.75rem] w-11 h-11 flex items-center justify-center">
              <MaterialIcon
                className="w-6 h-6 text-white"
                d="M4 6.47 5.76 10H20v8H4V6.47M22 4h-4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.89-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4Z"
              />
            </div>

            <div className="flex flex-wrap justify-end gap-1.5 max-w-[70%]">
              <span className="liquid-glass rounded-full px-3 py-1 text-[11px] text-white/90 font-body whitespace-nowrap">
                Методология ЗС
              </span>
              <span className="liquid-glass rounded-full px-3 py-1 text-[11px] text-white/90 font-body whitespace-nowrap">
                Рекомендации ДММБ
              </span>
              <span className="liquid-glass rounded-full px-3 py-1 text-[11px] text-white/90 font-body whitespace-nowrap">
                Сквозная коммуникация
              </span>
              <span className="liquid-glass rounded-full px-3 py-1 text-[11px] text-white/90 font-body whitespace-nowrap">
                Единые правила
              </span>
            </div>
          </div>

          <div className="flex-1" />

          <h3 className="font-heading italic text-white text-3xl md:text-4xl tracking-[-1px] leading-none">
            Вопросы и ответы по методологии
          </h3>
          <p className="mt-3 text-sm text-white/90 font-body font-light leading-snug max-w-[32ch]">
            ТМ получает вопросы по методологии взаимодействия и направляет их
            методологам ЗС и ДММБ, после чего возвращает КП итоговый ответ и
            согласованную практику.
          </p>
        </motion.article>

        <motion.article
          className="liquid-glass rounded-[1.25rem] p-6 min-h-[360px] flex flex-col"
          initial={{ filter: "blur(10px)", opacity: 0, y: 20 }}
          whileInView={{ filter: "blur(0px)", opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.6, delay: 0.1 }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="liquid-glass rounded-[0.75rem] w-11 h-11 flex items-center justify-center">
              <MaterialIcon
                className="w-6 h-6 text-white"
                d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1Zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7Z"
              />
            </div>

            <div className="flex flex-wrap justify-end gap-1.5 max-w-[70%]">
              <span className="liquid-glass rounded-full px-3 py-1 text-[11px] text-white/90 font-body whitespace-nowrap">
                Арбитражи
              </span>
              <span className="liquid-glass rounded-full px-3 py-1 text-[11px] text-white/90 font-body whitespace-nowrap">
                Риски и стоимость
              </span>
              <span className="liquid-glass rounded-full px-3 py-1 text-[11px] text-white/90 font-body whitespace-nowrap">
                Обучение КП
              </span>
              <span className="liquid-glass rounded-full px-3 py-1 text-[11px] text-white/90 font-body whitespace-nowrap">
                Оптимизация процессов
              </span>
            </div>
          </div>

          <div className="flex-1" />

          <h3 className="font-heading italic text-white text-3xl md:text-4xl tracking-[-1px] leading-none">
            Сопровождение и автономность
          </h3>
          <p className="mt-3 text-sm text-white/90 font-body font-light leading-snug max-w-[32ch]">
            ТМ взаимодействует с «Группой сопровождения ЗС» по вопросам арбитражей и
            направляет улучшения разработчикам АС, обеспечивая учет рисков при
            залоговых заключениях и регулярное обучение КП.
          </p>
        </motion.article>
      </div>
    </div>
  );
}

