import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
export default function Home() {
  return <AppShell view="home"><section className="landing-hero">
    <span className="eyebrow">SideQuest</span>
    <h1>Make plans. Keep the group chat.</h1>
    <p>Ask Sid in your group chat. Compare places, pick a time, and see who’s in.</p>
    <div className="standout-actions"><Link className="button" href="/try">Try an example</Link><Link className="button secondary" href="/signup?next=/plans">Use with my friends</Link><Link className="back" href="/login">Sign in</Link></div><p className="hint">No account needed for the example. Your own group stays private.</p>
  </section><section className="landing-steps" id="how-it-works">
    <article className="panel"><span className="eyebrow">01</span><h2>Ask in the chat.</h2><p>Tell Sid what you want to do and who’s coming. Add interests, or send a note privately.</p></article>
    <article className="panel"><span className="eyebrow">02</span><h2>Choose together.</h2><p>Compare three places and vote for what works. See the choices and linked chat here.</p></article>
    <article className="panel"><span className="eyebrow">03</span><h2>Go do it.</h2><p>Agree on a time, add the plan to your calendar, and try a few photo challenges or riddles when you get there.</p></article>
  </section></AppShell>;
}
