import { HeroContent } from "./components/HeroContent";
import { CapabilitiesContent } from "./components/CapabilitiesContent";
import { FadingVideo } from "./components/FadingVideo";
import { Navbar } from "./components/Navbar";

export default function App() {
  const HERO_VIDEO_SRC =
    "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260418_080021_d598092b-c4c2-4e53-8e46-94cf9064cd50.mp4";
  const CAPABILITIES_VIDEO_SRC =
    "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260418_094631_d30ab262-45ee-4b7d-99f3-5d5848c8ef13.mp4";

  return (
    <div className="relative bg-black text-white antialiased overflow-x-hidden">
      <Navbar />

      <section className="relative min-h-screen bg-black">
        <FadingVideo
          src={HERO_VIDEO_SRC}
          className="absolute left-1/2 top-0 -translate-x-1/2 object-cover z-0"
          style={{ width: "120%", height: "120%" }}
        />

        <div className="relative z-10 flex flex-col min-h-screen">
          <HeroContent />
        </div>
      </section>

      <section className="relative min-h-screen bg-black">
        <FadingVideo
          src={CAPABILITIES_VIDEO_SRC}
          className="absolute inset-0 w-full h-full object-cover z-0"
        />

        <div className="relative z-10 min-h-screen">
          <CapabilitiesContent />
        </div>
      </section>
    </div>
  );
}
