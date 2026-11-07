import type { Licence } from "@skolia/shared/api";

export interface LicenceInfo {
  /** Short name, for cards and credits. */
  short: string;
  /** Longer name, for the upload form. */
  label: string;
  /** The licence's deed, where there is one. */
  url: string | null;
}

export const LICENCE_INFO: Record<Licence, LicenceInfo> = {
  "public-domain": { short: "Public domain", label: "Public domain", url: null },
  cc0: { short: "CC0", label: "CC0 (no rights reserved)", url: "https://creativecommons.org/publicdomain/zero/1.0/" },
  "cc-by": { short: "CC BY", label: "CC BY (attribution)", url: "https://creativecommons.org/licenses/by/4.0/" },
  "cc-by-sa": { short: "CC BY-SA", label: "CC BY-SA (attribution, share-alike)", url: "https://creativecommons.org/licenses/by-sa/4.0/" },
  "cc-by-nc": { short: "CC BY-NC", label: "CC BY-NC (attribution, non-commercial)", url: "https://creativecommons.org/licenses/by-nc/4.0/" },
  "cc-by-nc-sa": {
    short: "CC BY-NC-SA",
    label: "CC BY-NC-SA (attribution, non-commercial, share-alike)",
    url: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
  },
  "cc-by-nd": { short: "CC BY-ND", label: "CC BY-ND (attribution, no derivatives)", url: "https://creativecommons.org/licenses/by-nd/4.0/" },
  "cc-by-nc-nd": {
    short: "CC BY-NC-ND",
    label: "CC BY-NC-ND (attribution, non-commercial, no derivatives)",
    url: "https://creativecommons.org/licenses/by-nc-nd/4.0/",
  },
  "all-rights-reserved": { short: "All rights reserved", label: "All rights reserved, or not sure", url: null },
  unknown: { short: "Licence unknown", label: "Unknown", url: null },
};
