import { useEffect, useState } from "react";
import { useTypewriter } from "../hooks/useTypewriter";

const TYPEWRITER_TEXT =
  "Актив понимает себя, управляет своей стоимостью и заменяет целые службы Сбера.";

const PILLS = [
  { href: "#profile", label: "Анализ рынка" },
  { href: "#profile", label: "Оценка онлайн" },
  { href: "#services", label: "Контроль залога" },
  { href: "#flow", label: "Как это работает" },
] as const;

const CONTACT_EMAIL = "ai.profile@sber.ru";

const pillClass =
  "mb-[0.4em] mx-[0.2em] inline-flex items-center justify-center whitespace-nowrap rounded-full px-4 py-[0.3em] text-[13px] transition-colors duration-200 sm:px-5 sm:text-[15px]";

function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <rect x="3.5" y="0.75" width="7.75" height="7.75" rx="1.2" stroke="currentColor" />
      <rect x="0.75" y="3.5" width="7.75" height="7.75" rx="1.2" stroke="currentColor" />
    </svg>
  );
}

export function HeroContent() {
  const { displayed, done } = useTypewriter(TYPEWRITER_TEXT);
  const [pillsOn, setPillsOn] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setPillsOn(true), 400);
    return () => window.clearTimeout(timeoutId);
  }, []);

  const copyEmail = () => {
    void navigator.clipboard.writeText(CONTACT_EMAIL).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <section
      id="hero"
      className="relative z-[1] flex h-screen flex-col overflow-hidden px-5 pb-12 sm:px-8 md:justify-center md:px-10 md:pb-0 justify-end"
    >
      <div className="relative z-10 max-w-xl">
        <p
          className="pointer-events-none mb-5 select-none font-normal text-black sm:mb-6"
          style={{
            fontSize: "clamp(18px, 4vw, 26px)",
            lineHeight: 1.3,
            filter: "blur(4px)",
          }}
        >
          Знакомьтесь — AI-профиль актива,
          <br />
          цифровой двойник, который работает 24/7
        </p>

        <p
          className="mb-5 min-h-[54px] font-normal text-black sm:mb-6"
          style={{ fontSize: "clamp(18px, 4vw, 26px)", lineHeight: 1.35 }}
        >
          {displayed}
          {done ? null : (
            <span className="cursor-blink ml-[2px] inline-block h-[1.1em] w-[2px] align-middle bg-black" />
          )}
        </p>

        <div
          className="flex flex-wrap gap-y-1"
          style={{
            opacity: pillsOn ? 1 : 0,
            transform: pillsOn ? "translateY(0)" : "translateY(8px)",
            transition: "opacity 0.4s ease, transform 0.4s ease",
          }}
        >
          {PILLS.map((pill) => (
            <a
              key={pill.label}
              href={pill.href}
              className={`${pillClass} border border-black/10 bg-white text-black hover:bg-black hover:text-white`}
            >
              {pill.label}
            </a>
          ))}
          <button
            type="button"
            onClick={copyEmail}
            className={`${pillClass} gap-2 border border-white bg-transparent text-white hover:bg-white hover:text-black sm:gap-3`}
          >
            <span>
              {copied ? "Скопировано: " : "Связь: "}
              <span className="underline underline-offset-1">{CONTACT_EMAIL}</span>
            </span>
            <CopyIcon />
          </button>
        </div>
      </div>
    </section>
  );
}
