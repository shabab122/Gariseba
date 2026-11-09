import { Link } from 'react-router-dom';
import {
  ArrowDown, ArrowRight, ArrowUpRight, BatteryCharging, ChevronDown, Clock3, ClipboardList, LifeBuoy,
  MapPin, MessageCircle, Route, ShieldCheck, Sparkles, Wrench,
} from 'lucide-react';
import { useApp } from './context.jsx';
import { ContactStrip, HelpLink, PageIntro, SafetyNotice } from './ui.jsx';
import { RoadGraphic } from './road-graphic.jsx';

const serviceIcons = { battery: BatteryCharging, repair: Wrench, other: LifeBuoy };
const howIcons = [ClipboardList, Route, ShieldCheck];

function Hero() {
  const { t } = useApp();
  return <section className="hero container-wide">
    <div className="hero-copy">
      <div className="eyebrow hero-kicker"><span className="signal-dot" />{t.heroTag}</div>
      <h1>{t.hero1}<br /><span>{t.hero2}</span></h1>
      <p className="hero-description">{t.heroBody}</p>
      <div className="hero-actions">
        <HelpLink>{t.request}</HelpLink>
        <Link to="/track" className="btn btn-outline">{t.track}<ArrowUpRight size={16} /></Link>
      </div>
      <div className="hero-meta"><span><MapPin size={16} />{t.coverage}</span><span><Clock3 size={16} />{t.intake}</span></div>
    </div>
    <div className="hero-board">
      <div className="board-top"><span>{t.heroBoard}</span><span><span className="signal-dot" />{t.heroMap}</span></div>
      <RoadGraphic />
      <div className="board-bottom"><div><span>{t.heroCar}</span><p>{t.heroCaption}</p></div><Route size={27} strokeWidth={1.3} /></div>
    </div>
  </section>;
}

function Services() {
  const { t } = useApp();
  return <section className="section container-wide" id="services">
    <div className="section-heading">
      <div><p className="eyebrow">{t.serviceLabel}</p><h2>{t.serviceTitle}</h2></div><p>{t.serviceText}</p>
    </div>
    <div className="grid gap-4 md:grid-cols-3">
      {t.serviceCards.map(([key, title, detail, action]) => {
        const Icon = serviceIcons[key];
        return <Link key={key} to={`/request?type=${key}`} className="service-card">
          <span className={`service-icon service-${key}`}><Icon size={24} strokeWidth={1.8} /></span>
          <ArrowUpRight className="service-corner" size={19} />
          <h3>{title}</h3><p>{detail}</p><span className="service-action">{action}<ArrowRight size={16} /></span>
        </Link>;
      })}
    </div>
  </section>;
}

function How() {
  const { t, lang } = useApp();
  const numbers = new Intl.NumberFormat(lang === 'bn' ? 'bn-BD' : 'en', { minimumIntegerDigits: 2 });
  return <section className="how-section">
    <div className="container-wide section">
      <div className="section-heading"><div><p className="eyebrow">{t.howLabel}</p><h2>{t.howTitle}</h2></div></div>
      <ol className="how-grid">
        {t.how.map(([title, detail], index) => {
          const Icon = howIcons[index];
          return <li key={title}><div className="how-number"><Icon size={21} />{numbers.format(index + 1)}</div><h3>{title}</h3><p>{detail}</p></li>;
        })}
      </ol>
    </div>
  </section>;
}

function AssistantTeaser() {
  const { t } = useApp();
  return <section className="assistant-teaser container-wide">
    <div className="assistant-banner">
      <div>
        <p className="eyebrow"><Sparkles size={17} />{t.chatLabel}</p>
        <h2>{t.chatTeaser}</h2><p className="banner-description">{t.chatPitch}</p>
        <Link to="/assistant" className="btn btn-accent">{t.assistant}<ArrowUpRight size={18} /></Link>
      </div>
      <div className="chat-preview">
        <p><MessageCircle size={15} />{t.example}</p>
        <div className="preview-user">{t.chatExample}</div>
        <div className="preview-bot"><Sparkles size={17} /><span>{t.chatExampleReply}</span></div>
      </div>
    </div>
  </section>;
}

export function Home() {
  const { t } = useApp();
  return <>
    <Hero />
    <div className="container-wide"><SafetyNotice /></div>
    <Services />
    <How />
    <AssistantTeaser />
    <section className="container-wide faq-section">
      <div><p className="eyebrow">{t.faqLabel}</p><h2>{t.faqTitle}</h2><ArrowDown className="faq-arrow" size={24} /></div>
      <div className="faq-list">
        {t.faq.map(([question, answer]) => <details key={question}><summary>{question}<ChevronDown size={18} /></summary><p>{answer}</p></details>)}
      </div>
    </section>
    <div className="container-wide"><ContactStrip /></div>
  </>;
}
export function Privacy() {
  const { t } = useApp();
  return <div className="container-narrow page-space">
    <PageIntro eyebrow={t.privacy.toUpperCase()} title={t.privacyTitle} description={t.privacyIntro} />
    <div className="panel privacy-copy">
      {t.privacySections.map(([title, text]) => <section key={title}><h2>{title}</h2><p>{text}</p></section>)}
      <Link to="/track" className="btn btn-outline">{t.track}<ArrowRight size={17} /></Link>
    </div>
  </div>;
}
