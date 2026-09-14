// Bordeaux Metropole neighbourhood/quartier names and centers, for labels on
// the map -- TBM's own basemap tiles (Esri Light Gray Canvas, see
// ensureLineMap in app.js) only carry commune-level place names, not this
// finer level. Sourced from OpenStreetMap (place=suburb/neighbourhood/quarter
// nodes within the TBM network's bounding box) via the Overpass API, since
// OSM is the most complete open source of this data for France and these
// names change rarely enough that a static, occasionally-refreshed snapshot
// beats a live fetch on every map open (see QUARTIERS_QUERY below to refresh).
//
// To refresh: run this Overpass query and regenerate the array below.
// QUARTIERS_QUERY = `
//   [out:json][timeout:60];
//   (node["place"~"^(suburb|neighbourhood|quarter)$"](44.72,-0.78,45.0,-0.42););
//   out body;
// `
export const QUARTIERS = [
  {
    "name": "Andrian",
    "lat": 44.909766,
    "lon": -0.623449
  },
  {
    "name": "Arago",
    "lat": 44.798166,
    "lon": -0.645593
  },
  {
    "name": "Arlac",
    "lat": 44.824432,
    "lon": -0.622408
  },
  {
    "name": "Astropark",
    "lat": 44.840822,
    "lon": -0.770113
  },
  {
    "name": "At'home",
    "lat": 44.886582,
    "lon": -0.668286
  },
  {
    "name": "Au Moura-Nord",
    "lat": 44.915344,
    "lon": -0.513106
  },
  {
    "name": "Au Moura-Sud",
    "lat": 44.91298,
    "lon": -0.516706
  },
  {
    "name": "Bacalan",
    "lat": 44.875943,
    "lon": -0.548349
  },
  {
    "name": "Barrière d'Arès",
    "lat": 44.836612,
    "lon": -0.598967
  },
  {
    "name": "Barrière de Bègles",
    "lat": 44.813431,
    "lon": -0.564665
  },
  {
    "name": "Barrière de Pessac",
    "lat": 44.825308,
    "lon": -0.589222
  },
  {
    "name": "Barrière de Toulouse",
    "lat": 44.814752,
    "lon": -0.572619
  },
  {
    "name": "Barrière du Médoc",
    "lat": 44.853856,
    "lon": -0.59343
  },
  {
    "name": "Barrière Judaïque",
    "lat": 44.840215,
    "lon": -0.599284
  },
  {
    "name": "Barrière Saint-Augustin",
    "lat": 44.833285,
    "lon": -0.598644
  },
  {
    "name": "Barrière Saint-Genès",
    "lat": 44.821321,
    "lon": -0.582974
  },
  {
    "name": "Barrière Saint-Médard",
    "lat": 44.848242,
    "lon": -0.597572
  },
  {
    "name": "Barthez",
    "lat": 44.769363,
    "lon": -0.599677
  },
  {
    "name": "Bassins à flot",
    "lat": 44.867603,
    "lon": -0.558153
  },
  {
    "name": "Bastide Niel",
    "lat": 44.846705,
    "lon": -0.555455
  },
  {
    "name": "Beau Désert",
    "lat": 44.845635,
    "lon": -0.691482
  },
  {
    "name": "Beausoleil",
    "lat": 44.758112,
    "lon": -0.625382
  },
  {
    "name": "Belcier",
    "lat": 44.82378,
    "lon": -0.550173
  },
  {
    "name": "Bénédigues",
    "lat": 44.782005,
    "lon": -0.592664
  },
  {
    "name": "Berlincan",
    "lat": 44.880525,
    "lon": -0.690798
  },
  {
    "name": "Betailhe",
    "lat": 44.858441,
    "lon": -0.497271
  },
  {
    "name": "Beutre",
    "lat": 44.815811,
    "lon": -0.698927
  },
  {
    "name": "Bigney",
    "lat": 44.910788,
    "lon": -0.612891
  },
  {
    "name": "Birehen",
    "lat": 44.911087,
    "lon": -0.618998
  },
  {
    "name": "Bois de Pinsan",
    "lat": 44.856717,
    "lon": -0.490931
  },
  {
    "name": "Bourran",
    "lat": 44.841799,
    "lon": -0.631462
  },
  {
    "name": "Bouscatet",
    "lat": 44.816198,
    "lon": -0.693127
  },
  {
    "name": "Breillan",
    "lat": 44.91646,
    "lon": -0.64859
  },
  {
    "name": "Camerouge",
    "lat": 44.905674,
    "lon": -0.622392
  },
  {
    "name": "Cantelaude",
    "lat": 44.913728,
    "lon": -0.649798
  },
  {
    "name": "Canteret",
    "lat": 44.904399,
    "lon": -0.633634
  },
  {
    "name": "Cantinolle",
    "lat": 44.892843,
    "lon": -0.66786
  },
  {
    "name": "Cap de Bos",
    "lat": 44.79209,
    "lon": -0.684003
  },
  {
    "name": "Capeyron",
    "lat": 44.851466,
    "lon": -0.644926
  },
  {
    "name": "Carriet",
    "lat": 44.883735,
    "lon": -0.524932
  },
  {
    "name": "Carthon-Ferrière",
    "lat": 44.78783,
    "lon": -0.602132
  },
  {
    "name": "Caudéran",
    "lat": 44.851797,
    "lon": -0.617508
  },
  {
    "name": "Caupian",
    "lat": 44.884053,
    "lon": -0.7389
  },
  {
    "name": "Caychac",
    "lat": 44.929339,
    "lon": -0.634674
  },
  {
    "name": "Cérillan",
    "lat": 44.894131,
    "lon": -0.756802
  },
  {
    "name": "Chambéry",
    "lat": 44.765697,
    "lon": -0.580167
  },
  {
    "name": "Chante-Coucou",
    "lat": 44.909014,
    "lon": -0.620418
  },
  {
    "name": "Chartrons",
    "lat": 44.858643,
    "lon": -0.564232
  },
  {
    "name": "Châtaigneraie",
    "lat": 44.794821,
    "lon": -0.64765
  },
  {
    "name": "Chemin Long",
    "lat": 44.829131,
    "lon": -0.668387
  },
  {
    "name": "Cholet",
    "lat": 44.90848,
    "lon": -0.638379
  },
  {
    "name": "Cimbats",
    "lat": 44.905751,
    "lon": -0.636186
  },
  {
    "name": "Cité Claveau",
    "lat": 44.879896,
    "lon": -0.547209
  },
  {
    "name": "Cité de l'Escaley",
    "lat": 44.921354,
    "lon": -0.423481
  },
  {
    "name": "Cité Jardin",
    "lat": 44.779342,
    "lon": -0.614109
  },
  {
    "name": "Corbiac",
    "lat": 44.870529,
    "lon": -0.708028
  },
  {
    "name": "Corn",
    "lat": 44.906491,
    "lon": -0.631483
  },
  {
    "name": "Coteau de la Moune",
    "lat": 44.864499,
    "lon": -0.476942
  },
  {
    "name": "Coulom",
    "lat": 44.913764,
    "lon": -0.637254
  },
  {
    "name": "Courlon",
    "lat": 44.805445,
    "lon": -0.534714
  },
  {
    "name": "Curégan",
    "lat": 44.905442,
    "lon": -0.628522
  },
  {
    "name": "Dehez",
    "lat": 44.908374,
    "lon": -0.614672
  },
  {
    "name": "Domaine d'Amanieu",
    "lat": 44.823162,
    "lon": -0.485729
  },
  {
    "name": "Domaine de Belfontaine",
    "lat": 44.826062,
    "lon": -0.497188
  },
  {
    "name": "Domaine de Belle Etoile",
    "lat": 44.825054,
    "lon": -0.476664
  },
  {
    "name": "Domaine de Berliquet",
    "lat": 44.813902,
    "lon": -0.497638
  },
  {
    "name": "Domaine de Canterane",
    "lat": 44.823625,
    "lon": -0.500518
  },
  {
    "name": "Domaine de Fayzeau",
    "lat": 44.823891,
    "lon": -0.480008
  },
  {
    "name": "Domaine Universitaire Pessac-Talence-Gradignan",
    "lat": 44.800085,
    "lon": -0.608617
  },
  {
    "name": "Dravemont",
    "lat": 44.845664,
    "lon": -0.51175
  },
  {
    "name": "Dulamon",
    "lat": 44.905595,
    "lon": -0.641808
  },
  {
    "name": "Favard",
    "lat": 44.78331,
    "lon": -0.602769
  },
  {
    "name": "Feydeau",
    "lat": 44.847424,
    "lon": -0.496822
  },
  {
    "name": "Fondaudège",
    "lat": 44.850866,
    "lon": -0.585816
  },
  {
    "name": "Fontaudin",
    "lat": 44.851309,
    "lon": -0.491003
  },
  {
    "name": "France",
    "lat": 44.79367,
    "lon": -0.668297
  },
  {
    "name": "Gajac",
    "lat": 44.888982,
    "lon": -0.701024
  },
  {
    "name": "Galochet",
    "lat": 44.912719,
    "lon": -0.638634
  },
  {
    "name": "Garigat",
    "lat": 44.942144,
    "lon": -0.631549
  },
  {
    "name": "Gaston",
    "lat": 44.77457,
    "lon": -0.589198
  },
  {
    "name": "Gazaillan-Nord",
    "lat": 44.779683,
    "lon": -0.598044
  },
  {
    "name": "Gazaillan-Sud",
    "lat": 44.777755,
    "lon": -0.600101
  },
  {
    "name": "Gazinet",
    "lat": 44.772006,
    "lon": -0.701861
  },
  {
    "name": "Gelès",
    "lat": 44.916502,
    "lon": -0.665975
  },
  {
    "name": "Génicart",
    "lat": 44.874308,
    "lon": -0.516893
  },
  {
    "name": "Germignan",
    "lat": 44.90854,
    "lon": -0.693116
  },
  {
    "name": "Grand Parc",
    "lat": 44.859393,
    "lon": -0.581824
  },
  {
    "name": "Grands Bois",
    "lat": 44.76776,
    "lon": -0.590622
  },
  {
    "name": "Grate-Cap",
    "lat": 44.909023,
    "lon": -0.649797
  },
  {
    "name": "Hameau du Bois Léger",
    "lat": 44.855738,
    "lon": -0.48567
  },
  {
    "name": "Hameau Eglise Romane",
    "lat": 44.86024,
    "lon": -0.498083
  },
  {
    "name": "Hastignan",
    "lat": 44.896699,
    "lon": -0.745385
  },
  {
    "name": "Hontane",
    "lat": 44.915085,
    "lon": -0.678857
  },
  {
    "name": "Hourcade",
    "lat": 44.790491,
    "lon": -0.546787
  },
  {
    "name": "Issac",
    "lat": 44.89705,
    "lon": -0.772531
  },
  {
    "name": "L'Alouette",
    "lat": 44.79913,
    "lon": -0.664348
  },
  {
    "name": "L'Aubarède",
    "lat": 44.916947,
    "lon": -0.63754
  },
  {
    "name": "La Bastide",
    "lat": 44.844506,
    "lon": -0.554058
  },
  {
    "name": "La Benauge",
    "lat": 44.844768,
    "lon": -0.543425
  },
  {
    "name": "La Bernadasse",
    "lat": 44.778964,
    "lon": -0.595888
  },
  {
    "name": "La Blancherie",
    "lat": 44.849189,
    "lon": -0.500401
  },
  {
    "name": "La Colline",
    "lat": 44.856227,
    "lon": -0.488541
  },
  {
    "name": "La Ferme",
    "lat": 44.872236,
    "lon": -0.481373
  },
  {
    "name": "La Forêt",
    "lat": 44.86335,
    "lon": -0.651557
  },
  {
    "name": "La Garenne",
    "lat": 44.860236,
    "lon": -0.498051
  },
  {
    "name": "La Glacière",
    "lat": 44.836207,
    "lon": -0.620127
  },
  {
    "name": "La House",
    "lat": 44.748247,
    "lon": -0.640879
  },
  {
    "name": "La Landille",
    "lat": 44.914207,
    "lon": -0.62604
  },
  {
    "name": "La Marègue",
    "lat": 44.849955,
    "lon": -0.506895
  },
  {
    "name": "La Renney",
    "lat": 44.911296,
    "lon": -0.627589
  },
  {
    "name": "La Rivière",
    "lat": 44.93214,
    "lon": -0.617445
  },
  {
    "name": "La Seleyre",
    "lat": 44.800613,
    "lon": -0.502405
  },
  {
    "name": "La Souys",
    "lat": 44.830294,
    "lon": -0.536157
  },
  {
    "name": "Lacaze",
    "lat": 44.917977,
    "lon": -0.625653
  },
  {
    "name": "Lacoste",
    "lat": 44.916097,
    "lon": -0.644126
  },
  {
    "name": "Lafon Féline",
    "lat": 44.867572,
    "lon": -0.616696
  },
  {
    "name": "Lagnet",
    "lat": 44.907871,
    "lon": -0.630361
  },
  {
    "name": "Lange",
    "lat": 44.780651,
    "lon": -0.610579
  },
  {
    "name": "Laurenzane",
    "lat": 44.772752,
    "lon": -0.608578
  },
  {
    "name": "Le Bois de Fontderode",
    "lat": 44.863102,
    "lon": -0.472558
  },
  {
    "name": "Le Bourdillat",
    "lat": 44.784059,
    "lon": -0.594989
  },
  {
    "name": "Le Bourg",
    "lat": 44.883819,
    "lon": -0.651169
  },
  {
    "name": "Le Bourg Ouest",
    "lat": 44.752783,
    "lon": -0.435858
  },
  {
    "name": "Le Brandier",
    "lat": 44.785472,
    "lon": -0.598699
  },
  {
    "name": "Le Burck",
    "lat": 44.816561,
    "lon": -0.639184
  },
  {
    "name": "Le Chouiney",
    "lat": 44.778203,
    "lon": -0.593984
  },
  {
    "name": "Le Clos",
    "lat": 44.912454,
    "lon": -0.633644
  },
  {
    "name": "Le Clos de Lalanne",
    "lat": 44.866368,
    "lon": -0.498264
  },
  {
    "name": "Le Desclaux",
    "lat": 44.856314,
    "lon": -0.488346
  },
  {
    "name": "Le Grand Louis",
    "lat": 44.861049,
    "lon": -0.642151
  },
  {
    "name": "Le Lac",
    "lat": 44.890647,
    "lon": -0.557234
  },
  {
    "name": "Le Landot",
    "lat": 44.940223,
    "lon": -0.631435
  },
  {
    "name": "Le Maurian",
    "lat": 44.921603,
    "lon": -0.631484
  },
  {
    "name": "Le Mirail",
    "lat": 44.866325,
    "lon": -0.490086
  },
  {
    "name": "Le Moulin de Monjoux",
    "lat": 44.776251,
    "lon": -0.593031
  },
  {
    "name": "Le Neurin",
    "lat": 44.935073,
    "lon": -0.629032
  },
  {
    "name": "Le Pailley-Nord",
    "lat": 44.780522,
    "lon": -0.600529
  },
  {
    "name": "Le Parc de Feydeau",
    "lat": 44.844065,
    "lon": -0.492317
  },
  {
    "name": "Le Plateau",
    "lat": 44.867054,
    "lon": -0.478251
  },
  {
    "name": "Le Port",
    "lat": 44.96695,
    "lon": -0.458437
  },
  {
    "name": "Le Poteau d'Yvrac",
    "lat": 44.865559,
    "lon": -0.472827
  },
  {
    "name": "Le Poujeau",
    "lat": 44.942774,
    "lon": -0.637981
  },
  {
    "name": "Le Sablat",
    "lat": 44.931536,
    "lon": -0.632278
  },
  {
    "name": "Le Tasta",
    "lat": 44.883043,
    "lon": -0.592083
  },
  {
    "name": "Le Tiscot",
    "lat": 44.904559,
    "lon": -0.618463
  },
  {
    "name": "Le Vigean",
    "lat": 44.883,
    "lon": -0.630853
  },
  {
    "name": "Les Bosquets de Techeney",
    "lat": 44.871939,
    "lon": -0.479847
  },
  {
    "name": "Les Castors",
    "lat": 44.794418,
    "lon": -0.673584
  },
  {
    "name": "Les Cinq Chemins",
    "lat": 44.861644,
    "lon": -0.696334
  },
  {
    "name": "Les Colonnes",
    "lat": 44.910193,
    "lon": -0.633678
  },
  {
    "name": "Les Eyquems",
    "lat": 44.827678,
    "lon": -0.646998
  },
  {
    "name": "Les Hauts d'Artigues",
    "lat": 44.864693,
    "lon": -0.497986
  },
  {
    "name": "Les Hauts de Greenfield",
    "lat": 44.813884,
    "lon": -0.500555
  },
  {
    "name": "Les Hauts de Labarde",
    "lat": 44.852418,
    "lon": -0.488116
  },
  {
    "name": "Les Hauts du Moulinat",
    "lat": 44.863008,
    "lon": -0.484001
  },
  {
    "name": "Les Jardins du Pinsan",
    "lat": 44.859432,
    "lon": -0.485583
  },
  {
    "name": "Les Pelouses d'Ascot",
    "lat": 44.822182,
    "lon": -0.490288
  },
  {
    "name": "Les Pins",
    "lat": 44.907331,
    "lon": -0.621319
  },
  {
    "name": "Les Pins-Francs",
    "lat": 44.858177,
    "lon": -0.623227
  },
  {
    "name": "Les Portes d'Artigues",
    "lat": 44.864417,
    "lon": -0.480301
  },
  {
    "name": "Les Quatre Pavillons",
    "lat": 44.865785,
    "lon": -0.513459
  },
  {
    "name": "Les Quatre Saisons",
    "lat": 44.869966,
    "lon": -0.475102
  },
  {
    "name": "Les Sables",
    "lat": 44.914838,
    "lon": -0.642599
  },
  {
    "name": "Les Tuillières",
    "lat": 44.944498,
    "lon": -0.632085
  },
  {
    "name": "Lestrille",
    "lat": 44.874308,
    "lon": -0.497257
  },
  {
    "name": "Linas",
    "lat": 44.925864,
    "lon": -0.645544
  },
  {
    "name": "Lissandre",
    "lat": 44.86477,
    "lon": -0.532861
  },
  {
    "name": "Lotissement Balcon de Fantaisie",
    "lat": 44.891548,
    "lon": -0.521076
  },
  {
    "name": "Lotissement Clairierre de Couvertaire",
    "lat": 44.916291,
    "lon": -0.448919
  },
  {
    "name": "Lotissement de la Pomme d'Or",
    "lat": 44.916044,
    "lon": -0.518669
  },
  {
    "name": "Lotissement du Grand Verger",
    "lat": 44.973958,
    "lon": -0.606625
  },
  {
    "name": "Lotissement Eyrin",
    "lat": 44.921627,
    "lon": -0.438045
  },
  {
    "name": "Lotissement La Vieille Ferme",
    "lat": 44.912166,
    "lon": -0.439043
  },
  {
    "name": "Lotissement Le Clos de Garry",
    "lat": 44.923203,
    "lon": -0.439632
  },
  {
    "name": "Lotissement Le Clos de Grafeuil",
    "lat": 44.904967,
    "lon": -0.431034
  },
  {
    "name": "Lotissement Le Domaine de l'Eau Vive",
    "lat": 44.916212,
    "lon": -0.44736
  },
  {
    "name": "Lotissement Le Domaine du Vallon",
    "lat": 44.917194,
    "lon": -0.433741
  },
  {
    "name": "Lotissement Le Hameau du Moulin Rouge",
    "lat": 44.905668,
    "lon": -0.4288
  },
  {
    "name": "Lotissement Le Verger de Peligon",
    "lat": 44.913016,
    "lon": -0.422012
  },
  {
    "name": "Lotissement Les Jardins de Barbeyrac",
    "lat": 44.911796,
    "lon": -0.433387
  },
  {
    "name": "Lotissement Les Jardins de Loustalot",
    "lat": 44.906878,
    "lon": -0.439045
  },
  {
    "name": "Lotissement Place de Caverne",
    "lat": 44.925222,
    "lon": -0.43261
  },
  {
    "name": "Magudas",
    "lat": 44.86394,
    "lon": -0.730666
  },
  {
    "name": "Malartic",
    "lat": 44.768128,
    "lon": -0.596284
  },
  {
    "name": "Mano",
    "lat": 44.749031,
    "lon": -0.682092
  },
  {
    "name": "Marpuch",
    "lat": 44.908873,
    "lon": -0.624682
  },
  {
    "name": "Médoquine",
    "lat": 44.818938,
    "lon": -0.599415
  },
  {
    "name": "Mériadeck",
    "lat": 44.83625,
    "lon": -0.586868
  },
  {
    "name": "Migron",
    "lat": 44.870384,
    "lon": -0.635325
  },
  {
    "name": "Mongirau",
    "lat": 44.910324,
    "lon": -0.650984
  },
  {
    "name": "Montigny",
    "lat": 44.911796,
    "lon": -0.631801
  },
  {
    "name": "Moulin de Cazeau",
    "lat": 44.779252,
    "lon": -0.591446
  },
  {
    "name": "Moulinat",
    "lat": 44.867677,
    "lon": -0.494403
  },
  {
    "name": "Moulineau",
    "lat": 44.769318,
    "lon": -0.605717
  },
  {
    "name": "Nansouty",
    "lat": 44.820156,
    "lon": -0.572223
  },
  {
    "name": "Parc du Peyrou",
    "lat": 44.867046,
    "lon": -0.47824
  },
  {
    "name": "Paul Doumer",
    "lat": 44.852113,
    "lon": -0.573939
  },
  {
    "name": "Perric",
    "lat": 44.931517,
    "lon": -0.626318
  },
  {
    "name": "Peybois",
    "lat": 44.937861,
    "lon": -0.637797
  },
  {
    "name": "Peyrestruc",
    "lat": 44.912714,
    "lon": -0.64439
  },
  {
    "name": "Pierroton",
    "lat": 44.741341,
    "lon": -0.763693
  },
  {
    "name": "Pinsan",
    "lat": 44.859521,
    "lon": -0.486928
  },
  {
    "name": "Plaisance",
    "lat": 44.862892,
    "lon": -0.506815
  },
  {
    "name": "Plantille",
    "lat": 44.906994,
    "lon": -0.625052
  },
  {
    "name": "Pouqueyras",
    "lat": 44.861795,
    "lon": -0.480963
  },
  {
    "name": "Pradau",
    "lat": 44.895049,
    "lon": -0.659316
  },
  {
    "name": "Queyron",
    "lat": 44.933066,
    "lon": -0.641189
  },
  {
    "name": "Quinconces",
    "lat": 44.845493,
    "lon": -0.574068
  },
  {
    "name": "Réjouits",
    "lat": 44.7383,
    "lon": -0.656971
  },
  {
    "name": "Résidence Betailhe",
    "lat": 44.856731,
    "lon": -0.496196
  },
  {
    "name": "Résidence Compostelle",
    "lat": 44.7948,
    "lon": -0.608425
  },
  {
    "name": "Résidence Le Mirail",
    "lat": 44.862927,
    "lon": -0.489869
  },
  {
    "name": "Résidence Les Hugons",
    "lat": 44.74957,
    "lon": -0.473705
  },
  {
    "name": "Résidence Philippe de Champaigne",
    "lat": 44.841811,
    "lon": -0.636533
  },
  {
    "name": "Résidences du Golf",
    "lat": 44.853118,
    "lon": -0.482092
  },
  {
    "name": "Ruisseau de Fontaudin",
    "lat": 44.850754,
    "lon": -0.491916
  },
  {
    "name": "Saige",
    "lat": 44.791516,
    "lon": -0.630631
  },
  {
    "name": "Saint Louis",
    "lat": 44.908406,
    "lon": -0.632673
  },
  {
    "name": "Saint-Ahon",
    "lat": 44.925685,
    "lon": -0.632265
  },
  {
    "name": "Saint-Augustin",
    "lat": 44.832339,
    "lon": -0.609029
  },
  {
    "name": "Saint-Bruno",
    "lat": 44.838247,
    "lon": -0.590472
  },
  {
    "name": "Saint-François-Xavier",
    "lat": 44.774082,
    "lon": -0.592661
  },
  {
    "name": "Saint-Genès",
    "lat": 44.826081,
    "lon": -0.58222
  },
  {
    "name": "Saint-Géry",
    "lat": 44.779712,
    "lon": -0.607612
  },
  {
    "name": "Saint-Jean",
    "lat": 44.823904,
    "lon": -0.557919
  },
  {
    "name": "Saint-Michel",
    "lat": 44.834134,
    "lon": -0.567349
  },
  {
    "name": "Saint-Seurin",
    "lat": 44.844476,
    "lon": -0.585824
  },
  {
    "name": "Saturne",
    "lat": 44.9096,
    "lon": -0.643993
  },
  {
    "name": "Solesse",
    "lat": 44.90509,
    "lon": -0.625046
  },
  {
    "name": "Terrefort",
    "lat": 44.924629,
    "lon": -0.637076
  },
  {
    "name": "Terres Neuves",
    "lat": 44.813237,
    "lon": -0.551104
  },
  {
    "name": "Thouars",
    "lat": 44.791045,
    "lon": -0.589454
  },
  {
    "name": "Toctoucau",
    "lat": 44.760241,
    "lon": -0.737208
  },
  {
    "name": "Tout Y Faut",
    "lat": 44.864774,
    "lon": -0.489163
  },
  {
    "name": "Triangle d'Or",
    "lat": 44.843287,
    "lon": -0.576885
  },
  {
    "name": "Tujean",
    "lat": 44.923803,
    "lon": -0.627002
  },
  {
    "name": "Vallon de Pinsan",
    "lat": 44.859349,
    "lon": -0.489928
  },
  {
    "name": "Vallons d'Artigues",
    "lat": 44.860229,
    "lon": -0.498099
  },
  {
    "name": "Victoire",
    "lat": 44.830624,
    "lon": -0.572624
  },
  {
    "name": "Vieux Lormont",
    "lat": 44.877071,
    "lon": -0.529589
  },
  {
    "name": "Villabois",
    "lat": 44.88587,
    "lon": -0.589529
  },
  {
    "name": "Villepreux",
    "lat": 44.911662,
    "lon": -0.74226
  },
  {
    "name": "Virebouc",
    "lat": 44.909162,
    "lon": -0.617494
  }
];
