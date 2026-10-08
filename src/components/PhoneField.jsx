import { useState } from 'react';
import Mi from './Mi.jsx';
import { COMMON_COUNTRIES, allCountries, countryName, dialCode, phoneCountry, resolvePhone } from '../lib/phone.js';

// One phone row of a form: a country-code picker, then the number. The picker
// follows what is typed (+971…, 971…, 01712…), and its choice is the country
// a number typed without a code is read in first. The line below shows the
// number as it will be saved; a number that is not a known mobile is flagged
// only once the field is left, so it does not flash up mid-typing. The picker
// is a native <select> laid transparently over its chip, so the list is the
// platform's own (type-to-find included). `children` (the row's remove button)
// sits at the end of the row.
export default function PhoneField({ text, country, onText, onCountry, placeholder, children }) {
  const [typing, setTyping] = useState(false);
  const shown = phoneCountry(text, country);
  const num = resolvePhone(text, country);
  return (
    <div className="ph">
      <div className="ph-row">
        <div className="ph-cc" title={shown.iso ? countryName(shown.iso) : undefined}>
          {shown.iso && <b>{shown.iso}</b>}{shown.dial}
          <Mi className="ph-cc-i" aria-hidden="true">expand_more</Mi>
          <select aria-label="Country code" value={shown.iso || country} onChange={e => onCountry(e.target.value)}>
            <optgroup label="Common">
              {COMMON_COUNTRIES.map(iso => <option key={iso} value={iso}>{countryName(iso)} {dialCode(iso)}</option>)}
            </optgroup>
            <optgroup label="All countries">
              {allCountries().map(c => <option key={c.iso} value={c.iso}>{c.name} {c.dial}</option>)}
            </optgroup>
          </select>
        </div>
        <input className="fi" type="tel" inputMode="tel" placeholder={placeholder} value={text} onChange={e => onText(e.target.value)}
          onFocus={() => setTyping(true)} onBlur={() => setTyping(false)} />
        {children}
      </div>
      {num?.valid && (
        <div className="ph-out"><Mi aria-hidden="true">check_circle</Mi>{num.display} · {num.country ? countryName(num.country) : 'International'}</div>
      )}
      {num && !num.valid && !typing && (
        <div className="ph-out warn"><Mi aria-hidden="true">warning</Mi>{num.display} · not a recognised mobile{num.country ? ` in ${countryName(num.country)}` : ''}, check it</div>
      )}
      {!num && !typing && text.trim() && (
        <div className="ph-out warn"><Mi aria-hidden="true">warning</Mi>Number incomplete, check the digits</div>
      )}
    </div>
  );
}
