import { BackgroundVideo } from "./components/BackgroundVideo";
import { HeroContent } from "./components/HeroContent";
import { Navbar } from "./components/Navbar";
import { Story } from "./components/Story";

export default function App() {
  return (
    <div className="relative overflow-x-hidden antialiased">
      <BackgroundVideo />
      <Navbar />
      <HeroContent />
      <Story />
    </div>
  );
}
