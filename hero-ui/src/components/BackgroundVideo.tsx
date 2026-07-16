import { useEffect, useRef } from "react";

const VIDEO_SRC =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260601_110537_3a579fa0-7bbc-4d94-9d25-0e816c7840f5.mp4";

export function BackgroundVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const enableMobileAutoplay = () => {
      if (window.innerWidth >= 1024) return;
      video.autoplay = true;
      void video.play().catch(() => {});
    };

    enableMobileAutoplay();

    let prevX = 0;
    let tracking = false;

    const handleMouseMove = (e: MouseEvent) => {
      if (window.innerWidth < 1024) return;
      if (!Number.isFinite(video.duration) || video.duration <= 0) return;

      if (!tracking) {
        prevX = e.clientX;
        tracking = true;
        return;
      }

      const delta = e.clientX - prevX;
      prevX = e.clientX;

      const targetTime =
        video.currentTime +
        (delta / window.innerWidth) * 0.8 * video.duration;

      video.currentTime = Math.max(0, Math.min(video.duration, targetTime));
    };

    const handleSeeked = () => {
      // ponytail: seeked keeps scrubbing aligned frame-to-frame after each jump
    };

    const handleResize = () => {
      if (window.innerWidth < 1024) {
        enableMobileAutoplay();
      } else {
        video.pause();
        video.autoplay = false;
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("resize", handleResize);
    video.addEventListener("seeked", handleSeeked);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("resize", handleResize);
      video.removeEventListener("seeked", handleSeeked);
    };
  }, []);

  return (
    <div className="order-last lg:order-none relative lg:absolute lg:inset-0 lg:z-0 overflow-hidden pointer-events-none w-full aspect-square md:aspect-video lg:aspect-auto lg:h-full bg-neutral-50 lg:bg-transparent">
      <video
        ref={videoRef}
        muted
        playsInline
        preload="auto"
        className="w-full h-full object-cover object-right lg:object-right-bottom"
      >
        <source src={VIDEO_SRC} type="video/mp4" />
      </video>
    </div>
  );
}
