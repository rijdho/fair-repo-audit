// Persistent-identifier structure: is a declared identifier actually one?
//
// DataCite accepts any string in nameIdentifier and affiliationIdentifier. A creator can
// carry nameIdentifierScheme "ORCID" with a null value, and an affiliation can say "ROR"
// and hold a website. Counting the scheme counts those as identified. These checks look at
// the value: its form, not whether it resolves (that would need a request per identifier).
//
// Measured on 10,686 Chilean DataCite datasets (2026-09-24): 41 of 56,241 declared ORCIDs
// fail (17 datasets carry a null); 33 of 8,546 affiliations labelled ROR are not ROR ids.

const ORCID_TAIL = /(\d{4}-\d{4}-\d{4}-\d{3}[\dX])\/?$/;
const ROR_ID = /^(?:https?:\/\/)?ror\.org\/0[a-hj-km-np-tv-z0-9]{6}\d{2}\/?$/i;

/** An ORCID iD, bare or as a URL, whose ISO 7064 11,2 check digit is right. */
function isOrcid(value) {
  if (typeof value !== 'string') return false;
  const m = ORCID_TAIL.exec(value.trim());
  if (!m) return false;
  const digits = m[1].replace(/-/g, '');
  let total = 0;
  for (const ch of digits.slice(0, -1)) total = (total + Number(ch)) * 2;
  const check = (12 - (total % 11)) % 11;
  return digits.at(-1) === (check === 10 ? 'X' : String(check));
}

/** A ROR id, bare path or URL: ror.org/0 + six Crockford base32 characters + two digits. */
function isRor(value) {
  return typeof value === 'string' && ROR_ID.test(value.trim());
}

/** A name identifier that is an ORCID: marked as one (scheme, schemeUri or the value), and well-formed. */
const isOrcidId = (n) => !!n && isOrcid(n.nameIdentifier)
  && (/^orcid$/i.test(n.nameIdentifierScheme ?? '') || /orcid\.org/i.test(n.schemeUri ?? '') || /orcid\.org/i.test(n.nameIdentifier));

/** A creator or contributor with at least one well-formed ORCID. */
export const hasOrcid = (person) => (person?.nameIdentifiers ?? []).some(isOrcidId);

/** The first well-formed ORCID of a person, for display. */
export const orcidOf = (person) => (person?.nameIdentifiers ?? []).find(isOrcidId)?.nameIdentifier;

/** An affiliation tied to a well-formed ROR id (scheme ROR, or a ror.org value). */
export const hasRor = (affiliation) =>
  !!affiliation && isRor(affiliation.affiliationIdentifier)
  && (!affiliation.affiliationIdentifierScheme || affiliation.affiliationIdentifierScheme.toUpperCase() === 'ROR');
