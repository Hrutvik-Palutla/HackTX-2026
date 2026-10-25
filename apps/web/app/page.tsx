import { SideQuestLogo } from "@/components/brand";
import { HomeSignIn } from "@/components/home-sign-in";
import { HomeIllustration } from "@/components/home-illustration";

export default function Home() {
  return (
    <div className="home">
      <HomeIllustration name="canoe" className="home-figure--nw" />
      <HomeIllustration name="movie-camera" className="home-figure--ne" />
      <HomeIllustration name="record-player" className="home-figure--sw" />
      <HomeIllustration name="dinner-table" className="home-figure--se" />
      <main className="home-center">
        <SideQuestLogo />
        <h1>Plans with friends, handled.</h1>
        <p className="home-lede">
          Tell SideQuest what you want to do and who’s coming. It finds a time that works, compares real places,
          and gets the group to yes, right in your group chat.
        </p>
        <HomeSignIn />
      </main>
    </div>
  );
}
