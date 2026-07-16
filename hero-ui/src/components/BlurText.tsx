import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";

export function BlurText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const ref = useRef<HTMLParagraphElement | null>(null);
  const [enabled, setEnabled] = useState(false);

  const words = useMemo(() => text.split(" ").filter(Boolean), [text]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (enabled) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting && entry.intersectionRatio >= 0.1) {
          setEnabled(true);
          observer.disconnect();
        }
      },
      { threshold: [0.1] },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled]);

  return (
    <p
      ref={ref}
      className={
        className ??
        "flex flex-wrap justify-center row-gap-0.1em leading-[0.8] tracking-[-4px]"
      }
    >
      {words.map((word, i) => (
        <motion.span
          // index is stable because `words` is derived from the same `text`
          key={`${word}-${i}`}
          style={{ display: "inline-block", marginRight: "0.28em" }}
          initial={{ filter: "blur(10px)", opacity: 0, y: 50 }}
          animate={
            enabled
              ? {
                  filter: ["blur(10px)", "blur(5px)", "blur(0px)"],
                  opacity: [0, 0.5, 1],
                  y: [50, -5, 0],
                }
              : { filter: "blur(10px)", opacity: 0, y: 50 }
          }
          transition={{
            duration: 0.7,
            times: [0, 0.5, 1],
            ease: "easeOut",
            delay: (i * 100) / 1000,
          }}
        >
          {word}
        </motion.span>
      ))}
    </p>
  );
}

