import { motion } from "motion/react";
import { BlurText } from "./BlurText";

function ArrowUpRightIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M7 17L17 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7 7H17V17"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <polygon fill="currentColor" points="6 4 20 12 6 20 6 4" />
    </svg>
  );
}

function ClockOutlineIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M12 7.5V12.2L15.2 14.1"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GlobeOutlineIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M3.7 10.2H20.3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M3.7 13.8H20.3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M12 3.2C9.5 5.9 9.5 18.1 12 20.8C14.5 18.1 14.5 5.9 12 3.2Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function HeroContent() {
  return (
    <main className="w-full flex flex-col min-h-screen items-center pt-24 px-4 pb-8">
      <div className="flex-1 w-full flex flex-col items-center justify-center">
        <motion.div
          initial={{ filter: "blur(10px)", opacity: 0, y: 20 }}
          animate={{ filter: "blur(0px)", opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="w-full flex flex-col items-center"
        >
          <div className="liquid-glass rounded-full px-3.5 py-1 text-xs font-medium text-white flex items-center">
            <span className="bg-white text-black px-3 py-1 rounded-full text-xs font-semibold">
              New
            </span>
            <span className="text-sm text-white/90 pr-3">
              Роль ТМ ММБ в ЗС: связка КП и ЗС для качества интеграции
            </span>
          </div>
        </motion.div>

        <motion.div
          initial={{ filter: "blur(10px)", opacity: 0, y: 20 }}
          animate={{ filter: "blur(0px)", opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.6 }}
          className="w-full flex flex-col items-center"
        >
          <BlurText
            text="Роль ТМ ММБ в ЗС"
            className="flex flex-wrap justify-center row-gap-[0.1em] text-6xl md:text-7xl lg:text-[5.5rem] font-heading italic text-white leading-[0.8] max-w-2xl tracking-[-4px] text-center"
          />
        </motion.div>

        <motion.p
          initial={{ filter: "blur(10px)", opacity: 0, y: 20 }}
          animate={{ filter: "blur(0px)", opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.8 }}
          className="mt-4 text-sm md:text-base text-white max-w-2xl font-body font-light leading-tight text-center"
        >
          ТМ ММБ обеспечивает устойчивую интеграцию АС СБОФ и АС Залоги:
          передает ошибки в разработку, возвращает обратную связь КП, уточняет
          методологию у ЗС и ДММБ, организует разбор арбитражей и регулярное
          обучение — для автономности и качества процессов.
        </motion.p>

        <motion.div
          initial={{ filter: "blur(10px)", opacity: 0, y: 20 }}
          animate={{ filter: "blur(0px)", opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 1.1 }}
          className="flex items-center gap-6 mt-6 justify-center"
        >
          <a
            href="#"
            className="liquid-glass-strong rounded-full px-5 py-2.5 text-sm font-medium text-white inline-flex items-center gap-3 hover:opacity-90"
          >
            Начать взаимодействие
            <ArrowUpRightIcon className="w-5 h-5" />
          </a>

          <a
            href="#"
            className="text-sm text-white/90 hover:opacity-70 inline-flex items-center gap-2 font-body"
          >
            Смотреть контур
            <PlayIcon className="w-4 h-4" />
          </a>
        </motion.div>

        <motion.div
          initial={{ filter: "blur(10px)", opacity: 0, y: 20 }}
          animate={{ filter: "blur(0px)", opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 1.3 }}
          className="flex items-stretch gap-4 mt-8 justify-center"
        >
          <div className="liquid-glass rounded-[1.25rem] p-5 w-[220px] flex flex-col">
            <div className="text-white flex items-center">
              <ClockOutlineIcon className="w-7 h-7" />
            </div>
            <div className="flex-1" />
            <div className="font-heading italic text-white text-4xl tracking-[-1px] leading-none">
              34.5 мин
            </div>
            <div className="text-xs text-white font-body font-light mt-2">
              Среднее время решения интеграционных дефектов
            </div>
          </div>

          <div className="liquid-glass rounded-[1.25rem] p-5 w-[220px] flex flex-col">
            <div className="text-white flex items-center">
              <GlobeOutlineIcon className="w-7 h-7" />
            </div>
            <div className="flex-1" />
            <div className="font-heading italic text-white text-4xl tracking-[-1px] leading-none">
              2.8B+
            </div>
            <div className="text-xs text-white font-body font-light mt-2">
              Пользователи в контуре взаимодействия
            </div>
          </div>
        </motion.div>
      </div>

      <motion.div
        initial={{ filter: "blur(10px)", opacity: 0, y: 20 }}
        animate={{ filter: "blur(0px)", opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 1.4 }}
        className="flex flex-col items-center gap-4 pb-8"
      >
        <div className="liquid-glass rounded-full chip px-3.5 py-1 text-xs font-medium text-white">
          Взаимодействуем с КП, ЗС и ММБ по единым правилам
        </div>

        <div className="font-heading italic text-white text-2xl md:text-3xl tracking-tight flex items-center gap-12 md:gap-16">
          <span>Aeon</span>
          <span className="opacity-90">·</span>
          <span>КП</span>
          <span className="opacity-90">·</span>
          <span>ЗС</span>
          <span className="opacity-90">·</span>
          <span>ДММБ</span>
          <span className="opacity-90">·</span>
          <span>Группа</span>
        </div>
      </motion.div>
    </main>
  );
}
