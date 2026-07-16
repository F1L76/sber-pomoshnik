import { CSSProperties, useEffect, useRef } from "react";

const FADE_MS = 500;
const FADE_OUT_LEAD = 0.55; // seconds before end

export function FadingVideo({
  src,
  className,
  style,
}: {
  src: string;
  className?: string;
  style?: CSSProperties;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const fadingOutRef = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const cancelRAF = () => {
      if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    };

    const fadeTo = (target: number, duration: number) => {
      cancelRAF();

      const startOpacity = Number.parseFloat(video.style.opacity || "0") || 0;
      const from = startOpacity;
      const to = target;
      const start = performance.now();

      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        const v = from + (to - from) * t;
        video.style.opacity = String(v);

        if (t < 1) rafIdRef.current = requestAnimationFrame(tick);
      };

      rafIdRef.current = requestAnimationFrame(tick);
    };

    const onLoadedData = () => {
      fadingOutRef.current = false;
      video.style.opacity = "0";

      void video.play().catch(() => {});
      fadeTo(1, FADE_MS);
    };

    const onTimeUpdate = () => {
      // ponytail: fade-out near the end to create seamless “crossfade” between loops
      const duration = video.duration;
      if (!Number.isFinite(duration) || duration <= 0) return;

      const remaining = duration - video.currentTime;
      if (
        !fadingOutRef.current &&
        remaining <= FADE_OUT_LEAD &&
        remaining > 0
      ) {
        fadingOutRef.current = true;
        fadeTo(0, FADE_MS);
      }
    };

    const onEnded = () => {
      video.style.opacity = "0";
      window.setTimeout(() => {
        video.currentTime = 0;
        fadingOutRef.current = false;
        void video.play().catch(() => {});
        fadeTo(1, FADE_MS);
      }, 100);
    };

    video.addEventListener("loadeddata", onLoadedData);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("ended", onEnded);

    return () => {
      cancelRAF();
      video.removeEventListener("loadeddata", onLoadedData);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("ended", onEnded);
    };
  }, []);

  return (
    <video
      ref={videoRef}
      autoPlay
      muted
      playsInline
      preload="auto"
      className={className}
      style={{ ...(style ?? {}), opacity: 0 }}
    >
      <source src={src} type="video/mp4" />
    </video>
  );
}

