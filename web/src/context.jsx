import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { bootstrap } from './api.js';
import { copy } from './copy.js';

const Context = createContext(null);
function preference(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function persist(key, value) {
  try { localStorage.setItem(key, value); } catch { /* preferences still work for the current page */ }
}
const errorsBn = {
  network: 'সেবার সঙ্গে সংযোগ করা যায়নি।', server: 'একটি সমস্যা হয়েছে। আবার চেষ্টা করুন।',
  csrf: 'সেশনের মেয়াদ শেষ হয়েছে। পাতা রিফ্রেশ করুন।', rate_limited: 'অনেকবার চেষ্টা হয়েছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।',
  validation: 'দেওয়া তথ্য যাচাই করুন।', outside_area: copy.bn.areaOutside, confirm_area: copy.bn.areaUnknown,
  not_found: 'এই তথ্য দিয়ে রেকর্ড পাওয়া যায়নি।', bad_type: copy.bn.photoType,
  bad_image: 'ছবিটি পড়া যায়নি।', photo_limit: 'সর্বোচ্চ পাঁচটি ছবি যোগ করতে পারবেন।',
  too_large: 'ফাইলটি অনেক বড়। ছোট একটি ছবি বেছে নিন।', photo_conflict: 'ড্রাফট বদলেছে অথবা পাঁচটি ছবি রয়েছে।',
  photos_changed: 'ড্রাফটের এক বা একাধিক ছবি পাওয়া যায়নি। ছবিগুলো যাচাই করুন।',
  draft_closed: 'ড্রাফট বন্ধ হয়েছে বা মেয়াদ শেষ। নতুন অনুরোধ শুরু করুন।',
  draft: 'নতুন ড্রাফট শুরু করতে ফর্মটি আবার খুলুন।', already_submitted: 'এই ড্রাফটটি জমা হয়েছে। আগের তথ্য দিয়ে চেষ্টা করুন।',
  scan_error: 'এখন ছবি যাচাই করা যাচ্ছে না। পরে আবার চেষ্টা করুন।', infected: 'ছবিটি নিরাপত্তা যাচাইয়ে গ্রহণ করা হয়নি।',
  upload: 'ছবি আপলোড হয়নি। আবার চেষ্টা করুন।',
};

export function AppProvider({ children }) {
  const [lang, setLang] = useState(() => preference('gariseba-language', 'en') === 'bn' ? 'bn' : 'en');
  const [theme, setTheme] = useState(() => preference('gariseba-theme', 'light') === 'dark' ? 'dark' : 'light');
  const [config, setConfig] = useState(null);
  const [configError, setConfigError] = useState(false);
  const refresh = useCallback(async (force = false) => {
    setConfigError(false);
    try { setConfig(await bootstrap(force)); } catch { setConfigError(true); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    document.documentElement.lang = lang;
    persist('gariseba-language', lang);
  }, [lang]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    persist('gariseba-theme', theme);
  }, [theme]);
  return <Context.Provider value={{
    lang, t: copy[lang], theme, setLang, setTheme, config, configError, refresh,
    errorText: (error) => lang === 'bn' ? errorsBn[error.code] || copy.bn.loadError
      : error.status ? error.message : copy.en.loadError,
  }}>{children}</Context.Provider>;
}

export const useApp = () => useContext(Context);
