// Bordeaux Metropole's open data (sv_chem_l dataset) files a big chunk of
// the bus network's route shapes under an old line numbering scheme that
// predates a TBM network renumbering -- the shapes themselves are genuine
// and correctly drawn, just tagged with the line's former id instead of
// its current one.
//
// Found by cross-checking every currently-untagged/mistagged line's real
// stops (from SIRI-Lite) against every shape record in the dataset: each
// value below is the only rs_sv_ligne_a tag, other than the line's own
// numeric id, whose shape passes within 150m of at least 85% of that
// line's actual stops (most hit 100%, and libelle fields corroborate them,
// e.g. tag "26" ends at "Beausoleil" -- line 31's real Gradignan terminus).
//
// Keyed by the line's numeric id once SIRI/GTFS-RT's zero-padding has
// already been stripped (see lineNumericId / the padding fix in
// fetchLineShapes).
export const LINE_SHAPE_OVERRIDES = {
  4: "3",
  19: "118", // Navette Arena
  22: "65",
  23: "21",
  24: "22",
  25: "23",
  26: "66",
  27: "24",
  28: "25",
  29: "67",
  30: "68",
  31: "26",
  32: "27",
  33: "69",
  34: "28",
  35: "29",
  37: "31",
  38: "70",
  39: "71",
  439: "80", // "39 Est"
  51: "81",
  53: "83",
  454: "84", // 54
  55: "44",
  57: "7",
  460: "88", // 60
  461: "89", // 61
  64: "49",
  65: "92",
  66: "50",
  67: "51",
  469: "95", // 69
  70: "52",
  71: "96",
  72: "97",
  73: "53",
  74: "54",
  75: "98",
  76: "99",
  77: "100",
  78: "55",
  80: "102",
  82: "104",
  83: "105",
  84: "106",
  85: "107",
  87: "57",
  89: "109",
  568: "79", // Flex' Artigues
  807: "88", // SCODI S07
  808: "105", // SCODI S08
  821: "2", // SCODI S21
  839: "44", // SCODI S39
  843: "100", // SCODI S43
  847: "53", // SCODI S47
  850: "109", // SCODI S50
  860: "55", // SCODI S60
  864: "81", // SCODI S64
  901: "34", // Bus Express G
  911: "36", // Bus Express H1
  912: "36", // Bus Express H2
  951: "111", // LE BATO 1
  952: "112", // LE BATO 2
  953: "113", // LE BATO 3
  58: "46", // TBNight N1
};
