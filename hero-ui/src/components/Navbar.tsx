import { useState } from "react";

const LINKS = [
  { href: "#flow", label: "Контур" },
  { href: "#profile", label: "Профиль" },
  { href: "#services", label: "Службы" },
  { href: "#value", label: "Ценность" },
] as const;

export function Navbar() {
  const [open, setOpen] = useState(false);

  const close = () => setOpen(false);

  return (
    <>
      <header className="fixed top-0 z-10 flex w-full items-center justify-between px-5 py-4 sm:px-8 sm:py-5">
        <a href="#hero" className="flex items-center gap-3 text-black" onClick={close}>
          <span
            className="text-[21px] tracking-tight sm:text-[26px]"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Сбер®
          </span>
          <span
            className="select-none text-[25px] sm:text-[30px]"
            style={{ letterSpacing: "-0.02em" }}
            aria-hidden="true"
          >
            ✳︎
          </span>
        </a>

        <nav
          className="hidden text-[23px] text-black md:flex"
          aria-label="Основная навигация"
        >
          {LINKS.map((link, index) => (
            <span key={link.href}>
              {index > 0 ? ", " : null}
              <a href={link.href} className="transition-opacity hover:opacity-60">
                {link.label}
              </a>
            </span>
          ))}
        </nav>

        <a
          href="#contact"
          className="hidden text-[23px] text-black underline underline-offset-2 transition-opacity hover:opacity-60 md:inline"
        >
          Связаться
        </a>

        <button
          type="button"
          className="flex flex-col gap-[5px] md:hidden"
          aria-label={open ? "Закрыть меню" : "Открыть меню"}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span
            className={`h-[2px] w-6 bg-black transition duration-300 ${open ? "translate-y-[7px] rotate-45" : ""}`}
          />
          <span
            className={`h-[2px] w-6 bg-black transition duration-300 ${open ? "opacity-0" : ""}`}
          />
          <span
            className={`h-[2px] w-6 bg-black transition duration-300 ${open ? "-translate-y-[7px] -rotate-45" : ""}`}
          />
        </button>
      </header>

      <div
        className={`fixed inset-0 z-[9] flex flex-col justify-center gap-8 bg-white/95 px-8 backdrop-blur-sm md:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        style={{ transition: "opacity 0.3s ease" }}
      >
        {LINKS.map((link) => (
          <a
            key={link.href}
            href={link.href}
            className="text-[32px] font-medium text-black"
            onClick={close}
          >
            {link.label}
          </a>
        ))}
        <a
          href="#contact"
          className="text-[32px] font-medium text-black underline underline-offset-2"
          onClick={close}
        >
          Связаться
        </a>
      </div>
    </>
  );
}
