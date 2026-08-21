import { useEffect, useRef } from "react";

const VIDEO_SRC =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260530_042513_df96a13b-6155-4f6e-8b93-c9dee66fba08.mp4";
const SENSITIVITY = 0.8;

export function BackgroundVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const prevX = useRef<number | null>(null);
  const targetTime = useRef(0);
  const seeking = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const flushSeek = () => {
      if (seeking.current) return;
      const next = targetTime.current;
      if (Math.abs(video.currentTime - next) < 0.001) return;
      seeking.current = true;
      video.currentTime = next;
    };

    const onSeeked = () => {
      seeking.current = false;
      flushSeek();
    };

    const onMouseMove = (event: MouseEvent) => {
      if (prevX.current === null) {
        prevX.current = event.clientX;
        return;
      }
      if (!video.duration) return;
      const delta = event.clientX - prevX.current;
      prevX.current = event.clientX;
      const offset = (delta / window.innerWidth) * SENSITIVITY * video.duration;
      targetTime.current = Math.min(
        video.duration,
        Math.max(0, targetTime.current + offset),
      );
      flushSeek();
    };

    video.addEventListener("seeked", onSeeked);
    window.addEventListener("mousemove", onMouseMove);
    return () => {
      video.removeEventListener("seeked", onSeeked);
      window.removeEventListener("mousemove", onMouseMove);
    };
  }, []);

  return (
    <video
      ref={videoRef}
      muted
      playsInline
      preload="auto"
      className="fixed inset-0 z-0 object-cover"
      style={{ objectPosition: "70% center" }}
    >
      <source src={VIDEO_SRC} type="video/mp4" />
    </video>
  );
}
