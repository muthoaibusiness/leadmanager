// Words shared by project matching in trainer-core.ts and document
// association in trainer-docs.ts. A leaf module, so neither imports the other.

// A word that is a common English word never resolves a project on its own;
// it only counts as part of a longer alias such as "summer breeze".
export const GENERIC = new Set(["summer", "arcade", "heritage", "breeze", "wecon", "mall", "manor", "orchid", "dale"]);
