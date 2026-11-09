import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, MessageCircle, RotateCcw, Send, ShieldCheck, Sparkles } from 'lucide-react';
import { api } from './api.js';
import { useApp } from './context.jsx';
import { Alert, Checkbox, Guidance, HelpLink, PageIntro } from './ui.jsx';

export default function Assistant() {
  const { t, lang, config, errorText } = useApp();
  const [turns, setTurns] = useState([]);
  const [question, setQuestion] = useState('');
  const [permission, setPermission] = useState(false);
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const thread = useRef(null);
  const controller = useRef(null);
  const configured = config?.integrations.ai === 'configured';
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (thread.current && (turns.length || pending)) thread.current.scrollTop = thread.current.scrollHeight;
  }, [turns, pending]);

  async function send(text) {
    const message = text.trim();
    if (controller.current || message.length < 3) return;
    const request = new AbortController();
    controller.current = request;
    setPending(message);
    setError('');
    try {
      const { analysis } = await api('/chat/analyze', {
        method: 'POST', signal: request.signal,
        body: { symptoms: message, language: lang, consent_ai: configured && permission, history: turns.slice(-4).map((turn) => turn.question) },
      });
      setTurns((current) => [...current, { question: message, analysis }]);
      setQuestion('');
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(errorText(err));
        setQuestion(message);
      }
    } finally {
      if (controller.current === request) {
        setPending('');
        controller.current = null;
      }
    }
  }
  function reset() {
    controller.current?.abort();
    controller.current = null;
    setTurns([]);
    setPending('');
    setQuestion('');
    setError('');
  }

  return <div className="container-wide page-space">
    <PageIntro eyebrow={t.assistantLabel} title={t.assistantTitle} description={t.assistantIntro} />
    <div className="assistant-grid">
      <section className="panel chat-panel" aria-label={t.assistantLabel}>
        <header className="chat-header">
          <div className="chat-icon"><Sparkles size={22} /></div>
          <div><h2>{t.assistantLabel}</h2><p>{configured ? t.assistantAvailable : t.assistantFallback}</p></div>
          <button type="button" className="icon-btn ml-auto" aria-label={t.clearChat} title={t.clearChat} onClick={reset}><RotateCcw size={18} /></button>
        </header>
        <div className="chat-thread" ref={thread} role="log" aria-label={t.assistantLabel}>
          <div className="chat-turn bot-turn"><MessageCircle size={18} /><div><strong>{t.assistantHello}</strong><p>{t.assistantStart}</p></div></div>
          {!turns.length && !pending && <div className="prompt-list">
            {t.prompts.map((item) => <button type="button" className="prompt" key={item} onClick={() => send(item)}>{item}<ArrowUpRight size={14} /></button>)}
          </div>}
          {turns.map(({ question: item, analysis }, index) => <div className="chat-pair" key={index}>
            <div className="chat-turn user-turn">{item}</div>
            <div className="chat-turn bot-turn bot-answer"><Sparkles size={18} /><Guidance analysis={analysis} /></div>
          </div>)}
          {pending && <><div className="chat-turn user-turn">{pending}</div><div className="chat-turn bot-turn"><Sparkles size={18} /><p>{t.chatWait}</p></div></>}
        </div>
        <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); send(question); }}>
          {error && <Alert>{error}</Alert>}
          {configured && <Checkbox checked={permission} disabled={!!pending} onChange={(event) => setPermission(event.target.checked)}>{t.consentAi}</Checkbox>}
          <label htmlFor="question" className="sr-only">{t.assistantInput}</label>
          <div className="composer-row">
            <textarea id="question" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={1000}
              disabled={!!pending} placeholder={t.assistantPlaceholder} rows={2}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault(); event.currentTarget.form.requestSubmit();
                }
              }} />
            <button className="btn btn-primary" type="submit" disabled={!!pending || question.trim().length < 3} aria-label={t.ask} title={t.ask}><Send size={21} /></button>
          </div>
          <p className="muted text-sm">{t.noPii}</p>
        </form>
      </section>
      <aside className="assistant-aside">
        <div className="panel side-panel">
          <div className="service-icon service-battery"><ShieldCheck size={23} /></div>
          <h2>{t.humanHelp}</h2><p className="muted">{t.tentative}</p>
          <HelpLink>{t.request}</HelpLink>
        </div>
        <div className="panel side-panel">
          <h2>{t.emergency}</h2><p className="muted">{t.emergencyLine}</p>
          <a className="text-link" href="tel:999">{t.emergencyButton}<ArrowUpRight size={16} /></a>
        </div>
        <Link className="text-link" to="/privacy">{t.privacy}<ArrowUpRight size={15} /></Link>
      </aside>
    </div>
  </div>;
}
