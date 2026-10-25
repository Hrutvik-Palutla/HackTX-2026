import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
export default function Home() {
  return <AppShell view="home"><section className="landing-hero">
    <span className="eyebrow">Friends. Common ground. A real adventure.</span>
    <h1>Turning “we should hang out” into plans that fit everyone’s interests and schedules.</h1>
    <p>Drop something you care about. Find the connection you didn’t know you shared. Choose a real outing together, then make it a quest.</p>
    <div className="standout-actions"><Link className="button" href="/signup">Start with your friends →</Link><Link className="button secondary" href="/demo">See the recorded demo</Link><Link className="back" href="/login">Sign in</Link></div>
  </section><section className="landing-steps">
    <article className="panel"><span className="eyebrow">01 · What are you into?</span><h2>More than a free calendar slot.</h2><p>A note, a photo, a voice note, or a link becomes suggested interests. You confirm what describes you and choose what friends can use.</p></article>
    <article className="panel"><span className="eyebrow">02 · Find our thing</span><h2>A reason this group should go.</h2><p>Shared interests become a specific idea, backed by your friends’ own confirmed quotes. Real search results keep the plan grounded.</p></article>
    <article className="panel"><span className="eyebrow">03 · Make it a quest</span><h2>Something to do together.</h2><p>Everyone agrees on the outing. Three photo challenges and two riddles turn showing up into a shared experience, with progress you can all see.</p></article>
  </section></AppShell>;
}
