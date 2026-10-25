import { SideQuestLogo } from "@/components/brand";
import { HomeSignIn } from "@/components/home-sign-in";
import { HomeIllustration } from "@/components/home-illustration";

// One day out, in reading order around the sign-in.
const DAY = [
  { name: "canoe", time: "9:00", label: "Paddle" },
  { name: "record-player", time: "1:30", label: "Records" },
  { name: "movie-camera", time: "7:15", label: "Late show" },
  { name: "dinner-table", time: "9:30", label: "Dinner" },
];

export default function Home() {
  return (
    <div className="home">
      <main className="home-center">
        <SideQuestLogo />
        <p className="home-tagline">Plans that make it out of the group chat.</p>
        <h1>Plans with friends, handled.</h1>
        <p className="home-lede">
          Tell SideQuest what you want to do and who’s coming. It finds a time, compares real places and gets everyone
          to a yes. Then the night turns into quests, badges and memories worth repeating.
        </p>
        <HomeSignIn />
      </main>
      {DAY.map((stop, index) => (
        <HomeIllustration key={stop.name} {...stop} index={index} />
      ))}
    </div>
  );
}
