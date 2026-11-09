import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { ArrowUpRight, Menu, Moon, Sun, X } from 'lucide-react';
import { Alert, Brand } from './ui.jsx';
import { useApp } from './context.jsx';

export function ThemeButton() {
  const { t, theme, setTheme } = useApp();
  const dark = theme === 'dark';
  return <button type="button" className="icon-btn theme-btn" aria-label={t.theme} title={t.theme} aria-pressed={dark} onClick={() => setTheme(dark ? 'light' : 'dark')}>
    {dark ? <Sun size={18} /> : <Moon size={18} />}
  </button>;
}

export function PublicLayout() {
  const { t, lang, setLang, config, configError, refresh } = useApp();
  const loc = useLocation();
  const previous = useRef(loc.pathname);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(false);
    const changed = previous.current !== loc.pathname;
    previous.current = loc.pathname;
    if (loc.hash) {
      const id = loc.hash.slice(1);
      if (id === 'services') requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
    } else if (changed) {
      window.scrollTo(0, 0);
      document.getElementById('main-content')?.focus({ preventScroll: true });
    }
  }, [loc.pathname, loc.hash]);

  const nav = [
    ['/#services', t.services], ['/assistant', t.assistant], ['/track', t.track],
  ];
  const phone = config?.business.whatsappNumber;
  return <>
    <a className="skip-link" href="#main-content">{t.skip}</a>
    <header className="site-header">
      <div className="container-wide header-inner">
        <Brand />
        <nav className={`main-nav ${open ? 'is-open' : ''}`} id="site-navigation" aria-label={lang === 'bn' ? 'মূল মেনু' : 'Main navigation'}>
          {nav.map(([path, label]) => path.includes('#')
            ? <Link key={path} to={path} onClick={() => setOpen(false)}>{label}</Link>
            : <NavLink key={path} to={path} onClick={() => setOpen(false)}>{label}</NavLink>)}
          <Link className="mobile-cta" to="/request" onClick={() => setOpen(false)}>{t.request}<ArrowUpRight size={16} /></Link>
        </nav>
        <div className="header-actions">
          <button type="button" className="lang-btn" title={t.language} aria-label={t.language} onClick={() => setLang(lang === 'en' ? 'bn' : 'en')}>
            <span lang={lang === 'en' ? 'bn' : 'en'}>{lang === 'en' ? 'বাংলা' : 'EN'}</span>
          </button>
          <ThemeButton />
          <Link to="/request" className="btn btn-header">{t.request}<ArrowUpRight size={16} /></Link>
          <button type="button" className="icon-btn mobile-toggle" aria-label={t.menu} aria-expanded={open} aria-controls="site-navigation" onClick={() => setOpen(!open)}>
            {open ? <X size={21} /> : <Menu size={21} />}
          </button>
        </div>
      </div>
    </header>
    <main id="main-content" tabIndex={-1}>
      {configError && <div className="container-wide pt-4"><Alert>{t.loadError} <button type="button" className="text-link" onClick={() => refresh(true)}>{t.retry}</button></Alert></div>}
      <Outlet />
    </main>
    <footer className="site-footer">
      <div className="container-wide footer-inner">
        <div><Brand /><p>{t.footer}</p></div>
        <div className="footer-links">
          <Link to="/privacy">{t.privacy}</Link><Link to="/admin">{t.staff}</Link>
          {phone && <a href={`https://wa.me/${phone.slice(1)}`} target="_blank" rel="noreferrer">{t.whatsapp}<ArrowUpRight size={14} /></a>}
        </div>
      </div>
    </footer>
  </>;
}
