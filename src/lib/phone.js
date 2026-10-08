import { AsYouType, getCountries, getCountryCallingCode, parsePhoneNumberFromString } from 'libphonenumber-js/mobile';
import metadata from 'libphonenumber-js/mobile/metadata';

// Phone entry: the country code is worked out from what is typed, so nobody
// adds it by hand. Every country libphonenumber knows is covered. What gets
// stored is unchanged — the full international number as digits, no '+'
// (8801712345678), the form normalizePhone() in db.js produces.
//
// The metadata is libphonenumber's mobile set: "valid" means a mobile number.
// Leads are reached on mobiles (calls, WhatsApp), and it is what tells a UAE
// mobile (050 123 4567) from a Bangladeshi landline of the same digits. A
// landline still saves; it is only flagged.

// Where our leads are (lead phones by country, Oct 2026): Bangladesh ~75%,
// UAE ~19%, then the Gulf, the US, the UK and Malaysia. These head the country
// picker, and a number typed without a country code is tried in them in this
// order (after the picked country), so a tie goes to the likelier one.
export const DEFAULT_COUNTRY = 'BD';
export const COMMON_COUNTRIES = ['BD', 'AE', 'SA', 'QA', 'OM', 'KW', 'BH', 'US', 'GB', 'MY'];

let names;
export function countryName(iso) {
  try {
    names ??= new Intl.DisplayNames(['en'], { type: 'region' });
    return names.of(iso) || iso;
  } catch {
    return iso;
  }
}

export const dialCode = (iso) => '+' + getCountryCallingCode(iso);

let all;
// Every country, A→Z by name.
export function allCountries() {
  all ??= getCountries()
    .map(iso => ({ iso, name: countryName(iso), dial: dialCode(iso) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return all;
}

// "+88 1712-345678": Bangladesh written with +88 and the trunk 0 dropped. As
// digits it reads as +881 (a satellite code); 217 leads were stored that way.
const BD_SHORT = /^88(1[3-9]\d{8})$/;

// The text's digits, and whether it was typed as an international number
// (a leading + or 00, which is dropped).
function split(text) {
  const raw = String(text || '').trim();
  let digits = raw.replace(/\D/g, '');
  const intl = raw.startsWith('+') || digits.startsWith('00');
  if (!raw.startsWith('+') && digits.startsWith('00')) digits = digits.slice(2);
  return { digits, intl };
}

// The main country of a calling code (+1 → US, +44 → GB); none for a
// non-geographic code (+881), which metadata lists as '001'.
const mainCountry = (code) => {
  const iso = metadata.country_calling_codes[code]?.[0];
  return iso && iso !== '001' ? iso : undefined;
};

// The full number for what was typed, read in `country` (the picker's choice)
// unless the text says otherwise. Readings, in order:
//   1. 88 + a Bangladeshi mobile without its 0 → Bangladesh
//   2. typed with + or 00 → international, as typed
//   3. a national number in `country` (01712-345678, 050 123 4567)
//   4. a national number in each common country, in lead order
//   5. a country code typed without the + (919812345678), real countries only
// The first valid one wins. Failing that, a reading of a possible length with
// at least 10 digits (the floor normalizePhone() has always applied), but
// never a guess (4): an unfinished Bangladeshi number must not turn Qatari.
// Returns null while the text cannot be a number yet, else
//   { country, code, digits, display, valid }
// where country is undefined for a non-geographic code (+881 …) and digits is
// the stored form.
export function resolvePhone(text, country = DEFAULT_COUNTRY) {
  const { digits, intl } = split(text);
  if (!digits) return null;
  const reads = [];
  const read = (n, guess = false) => { if (n) reads.push({ n, guess }); };
  const bd = digits.match(BD_SHORT);
  if (bd) read(parsePhoneNumberFromString('+880' + bd[1]));
  if (intl) read(parsePhoneNumberFromString('+' + digits));
  else {
    read(parsePhoneNumberFromString(digits, country));
    for (const c of COMMON_COUNTRIES) if (c !== country) read(parsePhoneNumberFromString(digits, c), true);
    const cc = parsePhoneNumberFromString('+' + digits);
    if (cc?.country) read(cc);
  }
  const n = reads.find(r => r.n.isValid())?.n
    || reads.find(r => !r.guess && r.n.isPossible() && r.n.number.length > 10)?.n;
  if (!n) return null;
  return {
    country: n.country || mainCountry(n.countryCallingCode),
    code: n.countryCallingCode,
    digits: n.number.slice(1),
    display: n.formatInternational(),
    valid: n.isValid(),
  };
}

// What the picker shows for the text so far: the resolved number's country;
// mid-way through an international number, the country its code points to
// (the main one where a code is shared: +1 → US); otherwise the picker's own
// choice. `iso` is undefined for a code with no country (+881).
export function phoneCountry(text, country = DEFAULT_COUNTRY) {
  const r = resolvePhone(text, country);
  if (r) return r.country ? { iso: r.country, dial: dialCode(r.country) } : { dial: '+' + r.code };
  const { digits, intl } = split(text);
  if (intl && digits) {
    const ay = new AsYouType();
    ay.input('+' + digits);
    const code = ay.getCallingCode();
    const iso = ay.getCountry() || mainCountry(code);
    if (iso) return { iso, dial: dialCode(iso) };
    if (code) return { dial: '+' + code };
  }
  return { iso: country, dial: dialCode(country) };
}
